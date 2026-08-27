import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "../env";
import type { DigestItemRow, SiteProfile } from "../types";
import { anthropic, fallbackParams } from "./client";
import { AUTHOR_VOICE_CONTRACT, HOUSE_STYLE } from "./house-style";
import { ArticleSchema, type Article } from "./schemas";

const WRITER_ROLE = `You are a senior staff writer at MediaDrumWorld, working from a
commissioning brief and an interview with the article's credited author.

You are not the author. The author is a named journalist who read the source
story and told you what they think about it. Your job is to build their piece:
their argument, their voice, their judgement, properly structured, accurate
about the underlying facts, and ready to publish.

The article is worth publishing only because of what the author brought to it.
If you find yourself writing a paragraph that is really just a summary of the
source article with adjectives, delete it and write what the author said instead.`;

const TONES: Record<string, string> = {
  "punchy-first-person":
    "First person, direct, opinionated. Short sentences. The author is present on the page from the first line.",
  "reported-with-voice":
    "Mostly reported third person, with the author stepping in explicitly for the judgements and the close.",
  analytical:
    "Measured and argued. Still first person, but the case is built step by step rather than asserted.",
  warm:
    "Warm and human. Leads with the people in the story; the author's take arrives through empathy rather than argument.",
};

export interface WriteInput {
  item: DigestItemRow;
  authorName: string;
  answers: { question: string; answer: string }[];
  extraNotes: string | null;
  chosenHeadline: string | null;
  tone: string;
  targetWords: number;
  profile: SiteProfile;
  sourceText: string | null;
}

export interface WriteResult extends Article {
  model: string;
  usage: { input: number; output: number };
  lint: string[];
}

/** Phrases that mark copy as machine-written. Checked after generation. */
const BANNED = [
  "in today's fast-paced",
  "in an era of",
  "now more than ever",
  "delve into",
  "delving into",
  "rich tapestry",
  "a testament to",
  "navigate the complexities",
  "game-changer",
  "game changer",
  "the landscape of",
  "at the end of the day",
  "it's worth noting",
  "it is worth noting",
  "in conclusion",
  "ultimately, the",
  "moreover,",
  "furthermore,",
  "what if i told you",
  "buckle up",
  "let's dive in",
  "the bottom line is",
];

const ALLOWED_TAGS = new Set([
  "p", "h2", "h3", "blockquote", "ul", "ol", "li", "strong", "em", "a", "br",
]);

/**
 * Post-generation checks. These do not block publishing -- they surface in the
 * editor notes so the human reviewing the draft knows where to look.
 */
export function lintArticle(article: Article, sourceUrl: string): string[] {
  const warnings: string[] = [];
  const lower = article.html.toLowerCase();

  const hits = BANNED.filter((phrase) => lower.includes(phrase));
  if (hits.length) {
    warnings.push(`House-style phrases to strip: ${hits.join(", ")}.`);
  }

  const usedTags = new Set(
    [...article.html.matchAll(/<\s*\/?\s*([a-z][a-z0-9]*)/gi)].map((match) =>
      match[1].toLowerCase(),
    ),
  );
  const disallowed = [...usedTags].filter((tag) => !ALLOWED_TAGS.has(tag));
  if (disallowed.length) {
    warnings.push(`Unexpected HTML tags in body: ${disallowed.join(", ")}.`);
  }

  try {
    const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
    if (!lower.includes(host.toLowerCase())) {
      warnings.push(
        `No link back to the original source (${host}). Add attribution before publishing.`,
      );
    }
  } catch {
    /* unparseable source URL; skip the check */
  }

  const wordCount = article.html.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
  if (wordCount < 450) {
    warnings.push(`Body is short (${wordCount} words) -- check it earns the headline.`);
  }

  if (article.meta_description.length > 165) {
    warnings.push(
      `Meta description is ${article.meta_description.length} characters; Google truncates past ~158.`,
    );
  }

  if (article.title.length > 75) {
    warnings.push(`Headline is ${article.title.length} characters; it will truncate in search.`);
  }

  return warnings;
}

export async function writeArticle(input: WriteInput): Promise<WriteResult> {
  const { item, authorName, answers, targetWords } = input;

  const toneGuidance =
    TONES[input.tone] ?? TONES["punchy-first-person"];

  const answersBlock = answers
    .filter((entry) => entry.answer.trim().length > 0)
    .map(
      (entry, index) =>
        `### Q${index + 1}. ${entry.question}\n${authorName} answered:\n"""\n${entry.answer.trim()}\n"""`,
    )
    .join("\n\n");

  const task = [
    `# The commission`,
    `Angle: ${item.angle_title}`,
    `The pitch: ${item.angle_pitch}`,
    `Why it suits the site: ${item.why_it_fits}`,
    "",
    `# The source story`,
    `Headline: ${item.source_headline}`,
    `Publication: ${item.source_name}`,
    `URL: ${item.source_url}`,
    "",
    `What happened:`,
    item.factual_summary,
    "",
    `Facts that must be correct:`,
    ...item.key_facts.map((fact) => `- ${fact}`),
    "",
    input.sourceText
      ? [`Original article text (for accuracy only -- do not rewrite it):`, `"""`, input.sourceText.slice(0, 8_000), `"""`].join("\n")
      : `(Original article text was not retrievable. Work strictly from the facts above and do not add detail.)`,
    "",
    `# ${authorName}'s answers -- this is the article`,
    answersBlock || "(No answers supplied.)",
    input.extraNotes?.trim()
      ? `\n### Additional notes from ${authorName}\n"""\n${input.extraNotes.trim()}\n"""`
      : "",
    "",
    `# SEO brief`,
    `Primary keyword: ${item.seo.primary_keyword}`,
    `Secondary keywords: ${(item.seo.secondary_keywords ?? []).join(", ")}`,
    `Search intent: ${item.seo.search_intent}`,
    `Suggested category: ${item.suggested_category ?? "latest-news"}`,
    `Suggested tags: ${(item.suggested_tags ?? []).join(", ")}`,
    "",
    `# Output requirements`,
    input.chosenHeadline
      ? `- The author picked this headline: "${input.chosenHeadline}". Use it, or a light edit of it if it is factually loose.`
      : `- Write the headline yourself, from these options: ${(item.headline_options ?? []).join(" | ")}`,
    `- Target roughly ${targetWords} words of body copy. Going under is fine if the`,
    `  material does not support more. Going over with filler is not.`,
    `- Tone: ${toneGuidance}`,
    `- Byline is ${authorName}. Write as ${authorName}, in first person where the`,
    `  answers are first person.`,
    `- Link to the original story at ${item.source_url} on first reference, using`,
    `  a normal <a href> inside a sentence.`,
    `- Body HTML only: no <h1>, no wrapper elements, no classes, no inline styles.`,
    `- If an answer is too thin to build on, do not invent around it. Use what is`,
    `  there and flag the gap in editor_notes.`,
  ]
    .filter(Boolean)
    .join("\n");

  const client = anthropic();

  const response = await client.beta.messages.parse({
    model: env.writingModel,
    max_tokens: 16_000,
    ...fallbackParams(env.writingModel),
    thinking: { type: "adaptive" },
    system: [
      { type: "text", text: WRITER_ROLE },
      { type: "text", text: HOUSE_STYLE },
      {
        type: "text",
        text: AUTHOR_VOICE_CONTRACT,
        cache_control: { type: "ephemeral" },
      },
    ],
    output_config: {
      effort: env.writingEffort,
      format: zodOutputFormat(ArticleSchema),
    },
    messages: [{ role: "user", content: task }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(
      `The model declined to write this piece (${response.stop_details?.category ?? "unknown"}).`,
    );
  }

  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Article generation returned no parseable output.");

  return {
    ...parsed,
    model: response.model,
    usage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
    lint: lintArticle(parsed, item.source_url),
  };
}
