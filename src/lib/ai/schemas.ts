import { z } from "zod";

/** Structured-output schemas for the two model calls in the pipeline. */

export const CuratedStorySchema = z.object({
  candidate_index: z
    .number()
    .int()
    .describe("Index of the chosen story in the candidate list you were given."),

  factual_summary: z
    .string()
    .describe(
      "What actually happened, in 3-5 sentences. Only facts present in the " +
        "supplied material. No spin, no adjectives that were not in the source.",
    ),

  key_facts: z
    .array(z.string())
    .min(3)
    .max(8)
    .describe(
      "The load-bearing facts a writer must not get wrong: names, numbers, " +
        "dates, places. Each one must appear in the supplied material.",
    ),

  angle_title: z
    .string()
    .describe(
      "The twist, in under 12 words. The specific argument or perspective " +
        "MediaDrumWorld would take that the original coverage did not.",
    ),

  angle_pitch: z
    .string()
    .describe(
      "2-4 sentences pitching the angle to the author: what the take is, why " +
        "it is not the obvious one, and what the piece would argue.",
    ),

  why_it_fits: z
    .string()
    .describe(
      "2-3 sentences on why this suits MediaDrumWorld's audience and beats " +
        "specifically, referencing the site's actual categories or past coverage.",
    ),

  headline_options: z
    .array(z.string())
    .min(3)
    .max(4)
    .describe("Headline options, 55-70 characters, British English, no clickbait lies."),

  questions: z
    .array(
      z.object({
        question: z
          .string()
          .describe(
            "A question that pulls out the author's own opinion, experience, " +
              "or judgement. Never answerable from the source article alone.",
          ),
        why: z
          .string()
          .describe("One short line telling the author what this unlocks in the piece."),
        placeholder: z
          .string()
          .describe("A short example answer showing the depth expected."),
      }),
    )
    .min(5)
    .max(6)
    .describe(
      "Questions for the author. At least one must ask for a personal " +
        "experience or anecdote, and at least one must invite disagreement " +
        "with the prevailing coverage.",
    ),

  suggested_category: z
    .string()
    .describe("One category slug from the site's real category list."),

  suggested_tags: z
    .array(z.string())
    .min(4)
    .max(10)
    .describe("Tags, preferring ones the site already uses."),

  seo: z.object({
    primary_keyword: z.string(),
    secondary_keywords: z.array(z.string()).min(2).max(6),
    search_intent: z
      .string()
      .describe("Who is searching this, and what they want to find."),
    meta_description: z.string().describe("140-158 characters."),
  }),
});

export const CurationSchema = z.object({
  stories: z.array(CuratedStorySchema),
  rejected_note: z
    .string()
    .describe(
      "One or two sentences on what you passed over and why -- useful signal " +
        "for tuning the source list.",
    ),
});

export type CuratedStory = z.infer<typeof CuratedStorySchema>;
export type Curation = z.infer<typeof CurationSchema>;

export const ArticleSchema = z.object({
  title: z.string().describe("Final headline. British English, 55-70 characters."),

  slug: z
    .string()
    .describe("URL slug: lowercase, hyphenated, 3-8 words, no stop-word padding."),

  excerpt: z
    .string()
    .describe("The standfirst shown on the site, 25-40 words, in the author's voice."),

  meta_description: z.string().describe("140-158 characters for search results."),

  html: z
    .string()
    .describe(
      "The article body as WordPress-ready HTML. Use only <p>, <h2>, <h3>, " +
        "<blockquote>, <ul>, <ol>, <li>, <strong>, <em>, and <a href>. " +
        "No <html>, <head>, <body>, no inline styles, no class attributes, " +
        "and no <h1> (WordPress renders the title itself).",
    ),

  tags: z.array(z.string()).min(4).max(10),

  category: z.string().describe("Category slug from the site's real list."),

  featured_image_brief: z
    .string()
    .describe(
      "What the picture desk should source for the lead image, and a caption " +
        "suggestion. Be specific about the shot, not the mood.",
    ),

  editor_notes: z
    .array(z.string())
    .describe(
      "Anything a human must check before publishing: claims that need " +
        "verification, facts you deliberately left out, legal or sensitivity " +
        "flags, and any place the author's answer was too thin to use well.",
    ),

  word_count: z.number().int().describe("Actual word count of the body copy."),
});

export type Article = z.infer<typeof ArticleSchema>;
