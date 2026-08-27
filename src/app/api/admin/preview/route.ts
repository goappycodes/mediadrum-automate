import { NextResponse, type NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase";
import { buildSiteProfile } from "@/lib/wordpress";
import { fetchAllSources } from "@/lib/sources/feed";
import { dedupe, diversify, scoreCandidate } from "@/lib/sources/rank";
import type { SiteProfile, SourceRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Everything the daily run does *up to* the model call: scrape, score, dedupe.
 *
 * No tokens spent, no email sent, no rows written. Use it to tune the source
 * list and the ranking weights and see what would have been shortlisted.
 */
export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);

  let profile: SiteProfile;
  try {
    profile = await buildSiteProfile();
  } catch {
    const { data } = await db().from("site_profile").select("*").eq("id", 1).maybeSingle();
    profile = (data ?? {
      categories: [],
      top_tags: [],
      recent_titles: [],
      keywords: [],
      refreshed_at: null,
    }) as SiteProfile;
  }

  const { data: sourceRows } = await db().from("sources").select("*").eq("enabled", true);
  const sources = (sourceRows ?? []) as SourceRow[];

  const feedResults = await fetchAllSources(sources);
  const cutoff = Date.now() - env.maxStoryAgeHours * 3_600_000;

  const all = feedResults.flatMap((result) => result.candidates);
  const fresh = all.filter(
    (candidate) =>
      !candidate.publishedAt || new Date(candidate.publishedAt).getTime() >= cutoff,
  );

  const scored = fresh.map((candidate) => scoreCandidate(candidate, profile));
  const sensitive = scored.filter((candidate) => candidate.sensitive).length;

  const sinceIso = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
  const { data: seenRows } = await db()
    .from("seen_items")
    .select("url_hash, title_key")
    .gte("first_seen_at", sinceIso)
    .limit(5_000);

  const { kept, dropped } = dedupe(
    scored.filter((candidate) => !candidate.sensitive),
    {
      seenUrlHashes: new Set((seenRows ?? []).map((row) => row.url_hash)),
      seenTitleKeys: (seenRows ?? []).map((row) => row.title_key),
      publishedTitles: profile.recent_titles,
    },
  );

  const shortlist = diversify(kept, limit);

  return NextResponse.json({
    sources: {
      total: sources.length,
      ok: feedResults.filter((r) => r.ok).length,
      failed: feedResults
        .filter((r) => !r.ok)
        .map((r) => ({ name: r.source.name, error: r.error })),
      yield: feedResults
        .map((r) => ({ name: r.source.name, items: r.candidates.length }))
        .sort((a, b) => b.items - a.items),
    },
    funnel: {
      scraped: all.length,
      withinAgeWindow: fresh.length,
      sensitiveSkipped: sensitive,
      deduped: dropped,
      unique: kept.length,
      shortlisted: shortlist.length,
    },
    shortlist: shortlist.map((candidate) => ({
      score: Math.round(candidate.score * 10) / 10,
      why: candidate.scoreReasons.join(" "),
      title: candidate.title,
      source: candidate.sourceName,
      beat: candidate.sourceBeat,
      published: candidate.publishedAt,
      url: candidate.url,
    })),
  });
}
