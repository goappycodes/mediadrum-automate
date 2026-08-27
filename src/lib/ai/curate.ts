import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "../env";
import type { SiteProfile } from "../types";
import type { ScoredCandidate } from "../sources/rank";
import type { ExtractedArticle } from "../sources/extract";
import { anthropic, fallbackParams } from "./client";
import { HOUSE_STYLE } from "./house-style";
import { CurationSchema, type Curation } from "./schemas";

const CURATION_ROLE = `You are the commissioning editor for MediaDrumWorld's daily
story meeting. Every morning you read everything the newsroom's feeds pulled in
overnight and pick the handful of stories worth a MediaDrumWorld article.

You are not picking the biggest stories. Wire services already own those, and
this site cannot outrank them. You are picking the stories where a
MediaDrumWorld writer with an opinion can add something that does not exist
anywhere else on the internet yet -- because that is the only thing that ranks.

For each story you pick, you produce three things:
  1. A faithful factual summary, so the writer cannot get the facts wrong.
  2. An angle -- the specific argument or perspective the original coverage
     missed, which this site is well placed to take.
  3. Questions that pull the writer's own opinion, experience and judgement out
     of them, because their answers become the substance of the article.

## What makes a good pick
- There is a real human at the centre of it, or a real image, or a real place.
- An opinionated writer could plausibly disagree with how it has been covered.
- It is not so time-critical that a next-day piece is worthless.
- It will still be searched for in three months. Evergreen beats breaking.
- It fits a beat this site actually publishes.

## What to reject
- Rolling political coverage, market moves, match reports, live blogs.
- Stories where the only possible article is a rewrite of the source.
- Anything requiring reporting resources this site does not have.
- Anything where a hot take would be tasteless: fresh bereavement, named
  private individuals in distress, ongoing criminal proceedings, child
  safeguarding. Skip these even when they would perform well.

## What makes a good question
The whole pipeline is worthless if the questions produce answers that a model
could have written. So:
- Ask about the writer's own experience, not their analysis of the topic.
- Ask what they think everyone else has got wrong.
- Ask for a concrete prediction, cost, number, or name they would stake.
- Ask what changed their mind, or what they used to believe.
- Never ask a question the source article already answers.
- Never ask "what are the implications of X" -- that produces slop.`;

interface CurateInput {
  candidates: ScoredCandidate[];
  articles: Map<string, ExtractedArticle>;
  profile: SiteProfile;
  count: number;
}

export interface CurationResult extends Curation {
  model: string;
  usage: { input: number; output: number };
}

function renderProfile(profile: SiteProfile): string {
  const categories = profile.categories
    .slice(0, 18)
    .map((c) => `${c.slug} (${c.count} posts)`)
    .join(", ");

  const tags = profile.top_tags
    .slice(0, 35)
    .map((t) => t.name)
    .join(", ");

  const recent = profile.recent_titles
    .slice(0, 30)
    .map((title) => `- ${title}`)
    .join("\n");

  return [
    "## The site's real categories",
    categories,
    "",
    "## The site's most used tags",
    tags,
    "",
    "## The 30 most recent published headlines",
    "Do not propose a story that duplicates any of these.",
    recent,
  ].join("\n");
}

function renderCandidates(
  candidates: ScoredCandidate[],
  articles: Map<string, ExtractedArticle>,
): string {
  return candidates
    .map((candidate, index) => {
      const extracted = articles.get(candidate.url);
      const body = extracted?.ok
        ? extracted.text.slice(0, env.curationTextBudget)
        : `[full text unavailable: ${extracted?.error ?? "not fetched"}]`;

      return [
        `### Candidate ${index}`,
        `Headline: ${candidate.title}`,
        `Source: ${candidate.sourceName}`,
        `URL: ${candidate.url}`,
        `Published: ${candidate.publishedAt ?? "unknown"}`,
        `Beat: ${candidate.sourceBeat}`,
        candidate.imageUrl ? `Lead image: ${candidate.imageUrl}` : "Lead image: none",
        "",
        "Feed summary:",
        candidate.summary || "(none)",
        "",
        "Article text:",
        body,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

/**
 * The daily story meeting. Returns the shortlist, each with an angle, an SEO
 * brief, and the questions that will be put to the author.
 */
export async function curateStories(
  input: CurateInput,
): Promise<CurationResult> {
  const { candidates, articles, profile, count } = input;

  const task = [
    renderProfile(profile),
    "",
    "---",
    "",
    `# Today's candidates (${candidates.length})`,
    "",
    renderCandidates(candidates, articles),
    "",
    "---",
    "",
    `# Your task`,
    `Pick exactly ${count} stories. Return them best-first.`,
    "",
    "Rules:",
    `- \`candidate_index\` must be the integer index of the candidate you chose.`,
    `- Never pick two stories that are really the same story.`,
    `- Vary the beats: do not return ${count} stories from one category.`,
    `- Every fact in \`factual_summary\` and \`key_facts\` must appear in the`,
    `  candidate's article text or feed summary above. If the article text was`,
    `  unavailable, keep the summary to what the headline and feed summary`,
    `  support, and say so.`,
    `- \`suggested_category\` must be one of the real category slugs listed above.`,
    `- If fewer than ${count} candidates clear the bar, return fewer. A short`,
    `  honest brief is better than padding it with stories that will not work.`,
  ].join("\n");

  const client = anthropic();

  const response = await client.beta.messages.parse({
    model: env.curationModel,
    max_tokens: 16_000,
    ...fallbackParams(env.curationModel),
    thinking: { type: "adaptive" },
    system: [
      { type: "text", text: CURATION_ROLE },
      { type: "text", text: HOUSE_STYLE, cache_control: { type: "ephemeral" } },
    ],
    output_config: {
      effort: env.curationEffort,
      format: zodOutputFormat(CurationSchema),
    },
    messages: [{ role: "user", content: task }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      `Curation declined by the model (${response.stop_details?.category ?? "unknown"}). ` +
        "This usually means a sensitive story dominated the candidate pool.",
    );
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("Curation returned no parseable output.");
  }

  return {
    ...parsed,
    model: response.model,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
  };
}
