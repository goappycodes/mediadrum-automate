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
  /** The publisher URL, once any Google News redirect has been unwrapped. */
  resolvedUrl: string;
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

/**
 * Google News RSS links point at a redirector, not the publisher, and the
 * interstitial is a JS app rather than a 302 -- so following redirects just
 * lands on google.com and extraction finds nothing. Before this existed, only
 * 11 of 28 shortlisted candidates yielded any article text.
 *
 * The real destination comes back from Google's own `batchexecute` RPC, given
 * the article id plus the signature and timestamp embedded in the page.
 *
 * This is an undocumented internal endpoint and will break at some point. It
 * fails soft: the caller keeps the Google link and briefs from the headline,
 * exactly as it did before, and `resolvedGoogleLinks` in the run stats makes a
 * regression visible rather than silent.
 */
async function resolveGoogleNews(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  if (!/(^|\.)news\.google\.com$/.test(parsed.hostname)) return url;

  try {
    const html = await fetchHtml(url);

    const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    const articleId = parsed.pathname.match(/\/articles\/([^?/]+)/)?.[1];

    if (!signature || !timestamp || !articleId) return url;

    const request = JSON.stringify([
      "garturlreq",
      [
        ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
        "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0,
      ],
      articleId,
      Number(timestamp),
      signature,
    ]);

    const response = await fetch(
      "https://news.google.com/_/DotsSplashUi/data/batchexecute",
      {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({
          "f.req": JSON.stringify([[["Fbv4je", request, null, "generic"]]]),
        }).toString(),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );

    if (!response.ok) return url;

    // The body is an anti-JSON-hijacking prefix followed by nested arrays,
    // where the payload we want is itself a JSON string.
    const envelope = JSON.parse(
      (await response.text()).replace(/^\)\]\}'\s*/, ""),
    ) as unknown[][];

    for (const row of envelope) {
      if (row?.[0] !== "wrb.fr" || row?.[1] !== "Fbv4je") continue;
      const payload = JSON.parse(String(row[2])) as unknown[];
      const resolved = payload[1];
      if (typeof resolved === "string" && /^https?:\/\//.test(resolved)) {
        return resolved;
      }
    }
  } catch {
    /* unreachable, changed shape, or rate-limited -- keep the Google link */
  }

  return url;
}

export async function extractArticle(
  inputUrl: string,
): Promise<ExtractedArticle> {
  const url = await resolveGoogleNews(inputUrl).catch(() => inputUrl);

  const empty: ExtractedArticle = {
    url: inputUrl,
    resolvedUrl: url,
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
      url: inputUrl,
      resolvedUrl: url,
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
