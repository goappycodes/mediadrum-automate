import "server-only";
import * as cheerio from "cheerio";
import { USER_AGENT } from "../env";
import { stripHtml } from "./normalize";

/**
 * Best-effort article text extraction.
 *
 * Order of preference: JSON-LD `articleBody` (publishers keep it accurate),
 * then a known article container, then the densest block of <p> tags. We only
 * need enough grounding for the curation and drafting prompts -- a few hundred
 * words of real body copy beats a perfect DOM reconstruction.
 */

const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 1_500_000;

const CONTAINER_SELECTORS = [
  "article",
  '[itemprop="articleBody"]',
  ".article-body",
  ".article__body",
  ".story-body",
  ".entry-content",
  ".post-content",
  ".content__article-body",
  "main",
];

const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "iframe",
  "figcaption",
  ".advert",
  ".ad",
  ".newsletter",
  ".related",
  ".share",
  ".social",
  '[aria-hidden="true"]',
];

export interface ExtractedArticle {
  url: string;
  title: string | null;
  text: string;
  imageUrl: string | null;
  publishedAt: string | null;
  siteName: string | null;
  ok: boolean;
  error?: string;
}

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("html")) throw new Error(`Not HTML (${type})`);

    const buffer = await response.arrayBuffer();
    return new TextDecoder("utf-8").decode(buffer.slice(0, MAX_BYTES));
  } finally {
    clearTimeout(timer);
  }
}

function fromJsonLd($: cheerio.CheerioAPI): {
  body: string | null;
  published: string | null;
  image: string | null;
} {
  let body: string | null = null;
  let published: string | null = null;
  let image: string | null = null;

  $('script[type="application/ld+json"]').each((_, element) => {
    if (body && published) return;

    const raw = $(element).contents().text();
    if (!raw.trim()) return;

    try {
      const parsed = JSON.parse(raw);
      const nodes: Record<string, unknown>[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed["@graph"])
          ? parsed["@graph"]
          : [parsed];

      for (const node of nodes) {
        const type = String(node["@type"] ?? "");
        if (!/Article|NewsArticle|BlogPosting|Report/i.test(type)) continue;

        if (!body && typeof node.articleBody === "string") {
          body = node.articleBody;
        }
        if (!published && typeof node.datePublished === "string") {
          published = node.datePublished;
        }
        if (!image) {
          const raw = node.image as unknown;
          if (typeof raw === "string") image = raw;
          else if (Array.isArray(raw) && typeof raw[0] === "string") image = raw[0];
          else if (raw && typeof raw === "object") {
            const url = (raw as Record<string, unknown>).url;
            if (typeof url === "string") image = url;
          }
        }
      }
    } catch {
      // Malformed JSON-LD is common; skip it.
    }
  });

  return { body, published, image };
}

function fromDom($: cheerio.CheerioAPI): string {
  for (const selector of CONTAINER_SELECTORS) {
    const container = $(selector).first();
    if (!container.length) continue;

    const paragraphs = container
      .find("p")
      .map((_, element) => $(element).text().trim())
      .get()
      .filter((line) => line.length > 40);

    const joined = paragraphs.join("\n\n");
    if (joined.length > 400) return joined;
  }

  // Last resort: every substantial paragraph on the page.
  return $("p")
    .map((_, element) => $(element).text().trim())
    .get()
    .filter((line) => line.length > 60)
    .join("\n\n");
}

export async function extractArticle(url: string): Promise<ExtractedArticle> {
  const empty: ExtractedArticle = {
    url,
    title: null,
    text: "",
    imageUrl: null,
    publishedAt: null,
    siteName: null,
    ok: false,
  };

  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);

    const meta = (property: string) =>
      $(`meta[property="${property}"]`).attr("content") ??
      $(`meta[name="${property}"]`).attr("content") ??
      null;

    $(NOISE_SELECTORS.join(",")).remove();

    const jsonLd = fromJsonLd($);
    const body = jsonLd.body ?? fromDom($);

    const text = stripHtml(body)
      .replace(/\s{3,}/g, "\n\n")
      .trim()
      .slice(0, 12_000);

    return {
      url,
      title: meta("og:title") ?? ($("h1").first().text().trim() || null),
      text,
      imageUrl: meta("og:image") ?? jsonLd.image,
      publishedAt: meta("article:published_time") ?? jsonLd.published,
      siteName: meta("og:site_name"),
      ok: text.length > 250,
    };
  } catch (error) {
    return {
      ...empty,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Extracts a batch of URLs with bounded concurrency. */
export async function extractMany(
  urls: string[],
  concurrency = 6,
): Promise<Map<string, ExtractedArticle>> {
  const results = new Map<string, ExtractedArticle>();
  const queue = [...urls];

  async function worker() {
    while (queue.length) {
      const url = queue.shift();
      if (!url) break;
      results.set(url, await extractArticle(url));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, worker),
  );

  return results;
}
