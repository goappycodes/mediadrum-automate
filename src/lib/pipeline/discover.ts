import "server-only";
import { env } from "../env";
import { db, log } from "../supabase";
import { buildSiteProfile } from "../wordpress";
import { fetchAllSources } from "../sources/feed";
import { extractMany } from "../sources/extract";
import {
  dedupe,
  diversify,
  scoreCandidate,
  type ScoredCandidate,
} from "../sources/rank";
import { curateStories } from "../ai/curate";
import { renderBriefEmail } from "../email/templates";
import { sendEmail } from "../email/send";
import { issueToken } from "../tokens";
import type { AuthorRow, DigestItemRow, SiteProfile, SourceRow } from "../types";

export interface DiscoverResult {
  digestId: string;
  runDate: string;
  status: "sent" | "empty" | "failed" | "skipped";
  scanned: number;
  kept: number;
  shortlisted: number;
  sourcesOk: number;
  sourcesFailed: number;
  emailed: { email: string; ok: boolean; error?: string }[];
  rejectedNote?: string;
  error?: string;
  durationMs: number;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function refreshSiteProfile(): Promise<SiteProfile> {
  const profile = await buildSiteProfile();

  await db()
    .from("site_profile")
    .update({
      categories: profile.categories,
      top_tags: profile.top_tags,
      recent_titles: profile.recent_titles,
      keywords: profile.keywords,
      refreshed_at: profile.refreshed_at,
    })
    .eq("id", 1);

  return profile;
}

/** Falls back to the cached snapshot if WordPress is unreachable this morning. */
async function loadSiteProfile(runId: string): Promise<SiteProfile> {
  try {
    return await refreshSiteProfile();
  } catch (error) {
    await log("discover", "warn", "Could not refresh the site profile from WordPress; using the cached snapshot.", { error: String(error) }, runId);

    const { data } = await db()
      .from("site_profile")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    return {
      categories: data?.categories ?? [],
      top_tags: data?.top_tags ?? [],
      recent_titles: data?.recent_titles ?? [],
      keywords: data?.keywords ?? [],
      refreshed_at: data?.refreshed_at ?? null,
    };
  }
}

/**
 * The daily job: scrape, rank, dedupe, read, commission, email.
 *
 * Idempotent per calendar day -- a second call on the same date returns the
 * existing digest untouched unless `force` is set.
 */
export async function runDiscovery(
  options: { force?: boolean } = {},
): Promise<DiscoverResult> {
  const startedAt = Date.now();
  const runDate = todayUtc();

  // ---- 1. Claim today's run -------------------------------------------------
  const { data: existing } = await db()
    .from("digests")
    .select("*")
    .eq("run_date", runDate)
    .maybeSingle();

  if (existing && !options.force) {
    if (existing.status === "sent" || existing.status === "running") {
      return {
        digestId: existing.id,
        runDate,
        status: "skipped",
        scanned: existing.candidates_scanned,
        kept: existing.candidates_kept,
        shortlisted: 0,
        sourcesOk: existing.sources_ok,
        sourcesFailed: existing.sources_failed,
        emailed: [],
        durationMs: Date.now() - startedAt,
      };
    }
  }

  if (existing?.id && options.force) {
    await db().from("digests").delete().eq("id", existing.id);
  }

  const { data: digest, error: digestError } = await db()
    .from("digests")
    .insert({ run_date: runDate, status: "running" })
    .select()
    .single();

  if (digestError || !digest) {
    throw new Error(`Could not start today's digest: ${digestError?.message}`);
  }

  const runId = digest.id as string;

  try {
    // ---- 2. What does this site actually publish? ---------------------------
    const profile = await loadSiteProfile(runId);
    await log("discover", "info", `Site profile: ${profile.categories.length} categories, ${profile.recent_titles.length} recent headlines.`, undefined, runId);

    // ---- 3. Scrape every enabled source ------------------------------------
    const { data: sourceRows } = await db()
      .from("sources")
      .select("*")
      .eq("enabled", true);

    const sources = (sourceRows ?? []) as SourceRow[];
    if (sources.length === 0) throw new Error("No enabled sources configured.");

    const feedResults = await fetchAllSources(sources);
    const sourcesOk = feedResults.filter((r) => r.ok).length;
    const sourcesFailed = feedResults.length - sourcesOk;

    await Promise.all(
      feedResults.map((result) =>
        db()
          .from("sources")
          .update({
            last_fetched_at: new Date().toISOString(),
            last_status: result.ok ? "ok" : `error: ${result.error}`.slice(0, 300),
            last_item_count: result.candidates.length,
          })
          .eq("id", result.source.id),
      ),
    );

    for (const failure of feedResults.filter((r) => !r.ok)) {
      await log("discover", "warn", `Source failed: ${failure.source.name}`, { error: failure.error }, runId);
    }

    // ---- 4. Age filter + score ---------------------------------------------
    const cutoff = Date.now() - env.maxStoryAgeHours * 3_600_000;

    const allCandidates = feedResults.flatMap((result) => result.candidates);
    const fresh = allCandidates.filter((candidate) => {
      if (!candidate.publishedAt) return true; // unknown dates get the benefit of the doubt
      return new Date(candidate.publishedAt).getTime() >= cutoff;
    });

    const scored: ScoredCandidate[] = fresh
      .map((candidate) => scoreCandidate(candidate, profile))
      .filter((candidate) => !candidate.sensitive);

    await log("discover", "info", `Scanned ${allCandidates.length} items from ${sourcesOk}/${sources.length} sources; ${scored.length} in scope.`, undefined, runId);

    // ---- 5. Dedupe against history and against the live site ----------------
    const sinceIso = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
    const { data: seenRows } = await db()
      .from("seen_items")
      .select("url_hash, title_key")
      .gte("first_seen_at", sinceIso)
      .limit(5_000);

    const { kept, dropped } = dedupe(scored, {
      seenUrlHashes: new Set((seenRows ?? []).map((row) => row.url_hash)),
      seenTitleKeys: (seenRows ?? []).map((row) => row.title_key),
      publishedTitles: profile.recent_titles,
    });

    await log("discover", "info", `Dedupe removed ${dropped}; ${kept.length} unique stories remain.`, undefined, runId);

    const shortlist = diversify(kept, env.deepReadCount);

    if (shortlist.length === 0) {
      await db()
        .from("digests")
        .update({
          status: "empty",
          candidates_scanned: allCandidates.length,
          candidates_kept: 0,
          sources_ok: sourcesOk,
          sources_failed: sourcesFailed,
        })
        .eq("id", runId);

      return {
        digestId: runId,
        runDate,
        status: "empty",
        scanned: allCandidates.length,
        kept: 0,
        shortlisted: 0,
        sourcesOk,
        sourcesFailed,
        emailed: [],
        durationMs: Date.now() - startedAt,
      };
    }

    // ---- 6. Read the shortlist properly ------------------------------------
    const articles = await extractMany(shortlist.map((c) => c.url));
    const readable = [...articles.values()].filter((a) => a.ok).length;
    await log("discover", "info", `Fetched full text for ${readable}/${shortlist.length} shortlisted stories.`, undefined, runId);

    // Record what we considered so tomorrow's run does not re-pitch it.
    await db()
      .from("seen_items")
      .upsert(
        shortlist.map((candidate) => ({
          url_hash: candidate.urlHash,
          canonical_url: candidate.canonicalUrl,
          title: candidate.title,
          title_key: candidate.titleKey,
          source_name: candidate.sourceName,
          published_at: candidate.publishedAt,
        })),
        { onConflict: "url_hash", ignoreDuplicates: true },
      );

    // ---- 7. The story meeting ----------------------------------------------
    const curation = await curateStories({
      candidates: shortlist,
      articles,
      profile,
      count: env.shortlistSize,
    });

    await log("discover", "info", `Commissioned ${curation.stories.length} stories with ${curation.model}.`, { usage: curation.usage, rejected: curation.rejected_note }, runId);

    // ---- 8. Persist the brief ----------------------------------------------
    const rows = curation.stories
      .map((story, position) => {
        const candidate = shortlist[story.candidate_index];
        if (!candidate) return null;

        const extracted = articles.get(candidate.url);

        return {
          digest_id: runId,
          position,
          source_headline: candidate.title,
          source_name: candidate.sourceName,
          source_url: candidate.url,
          source_published_at: candidate.publishedAt,
          image_url: candidate.imageUrl ?? extracted?.imageUrl ?? null,
          factual_summary: story.factual_summary,
          key_facts: story.key_facts,
          source_excerpt: extracted?.ok ? extracted.text.slice(0, 6_000) : null,
          angle_title: story.angle_title,
          angle_pitch: story.angle_pitch,
          why_it_fits: story.why_it_fits,
          headline_options: story.headline_options,
          questions: story.questions.map((question, index) => ({
            id: `q${index + 1}`,
            question: question.question,
            why: question.why,
            placeholder: question.placeholder,
          })),
          suggested_category: story.suggested_category,
          suggested_tags: story.suggested_tags,
          seo: story.seo,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (rows.length === 0) {
      throw new Error("Curation returned stories, but none mapped to a candidate.");
    }

    const { data: itemRows, error: itemsError } = await db()
      .from("digest_items")
      .insert(rows)
      .select();

    if (itemsError) throw new Error(`Could not save the brief: ${itemsError.message}`);

    const items = (itemRows ?? []) as DigestItemRow[];
    items.sort((a, b) => a.position - b.position);

    // ---- 9. Email the authors ----------------------------------------------
    const { data: authorRows } = await db()
      .from("authors")
      .select("*")
      .eq("active", true);

    const authors = (authorRows ?? []) as AuthorRow[];
    const emailed: DiscoverResult["emailed"] = [];

    for (const author of authors) {
      // An author with beats set only hears about stories on those beats.
      const relevant = author.beats.length
        ? items.filter((item) =>
            author.beats.includes(item.suggested_category ?? ""),
          )
        : items;

      if (relevant.length === 0) {
        emailed.push({ email: author.email, ok: false, error: "no stories on this author's beats" });
        continue;
      }

      const token = await issueToken(runId, author.id);
      const briefUrl = `${env.appUrl}/brief/${token}`;

      const email = renderBriefEmail({
        authorName: author.name,
        runDate,
        items: relevant,
        briefUrl,
        writeUrlFor: (itemId) => `${briefUrl}/write/${itemId}`,
      });

      const result = await sendEmail({
        to: author.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });

      emailed.push({ email: author.email, ok: result.ok, error: result.error });
    }

    await db()
      .from("digests")
      .update({
        status: "sent",
        candidates_scanned: allCandidates.length,
        candidates_kept: kept.length,
        sources_ok: sourcesOk,
        sources_failed: sourcesFailed,
        model: curation.model,
        sent_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return {
      digestId: runId,
      runDate,
      status: "sent",
      scanned: allCandidates.length,
      kept: kept.length,
      shortlisted: items.length,
      sourcesOk,
      sourcesFailed,
      emailed,
      rejectedNote: curation.rejected_note,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await log("discover", "error", "Discovery run failed", { message }, runId);

    await db()
      .from("digests")
      .update({ status: "failed", error: message.slice(0, 2_000) })
      .eq("id", runId);

    return {
      digestId: runId,
      runDate,
      status: "failed",
      scanned: 0,
      kept: 0,
      shortlisted: 0,
      sourcesOk: 0,
      sourcesFailed: 0,
      emailed: [],
      error: message,
      durationMs: Date.now() - startedAt,
    };
  }
}
