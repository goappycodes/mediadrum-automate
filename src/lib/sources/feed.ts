import "server-only";
import { XMLParser } from "fast-xml-parser";
import { USER_AGENT } from "../env";
import type { Candidate, SourceRow } from "../types";
import { canonicalUrl, hashUrl, stripHtml, titleKey } from "./normalize";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
  // Feeds mix CDATA and plain text; treat everything as a string.
  textNodeName: "#text",
});

const FETCH_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOnce(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`) as Error & {
        status: number;
        retryAfter?: number;
      };
      error.status = response.status;
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) error.retryAfter = Number(retryAfter);
      throw error;
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reddit in particular rate-limits bursts of anonymous RSS requests, so a 429
 * or 5xx gets one backed-off retry before the source is written off for the day.
 */
async function fetchText(url: string): Promise<string> {
  try {
    return await fetchOnce(url);
  } catch (error) {
    const status = (error as { status?: number }).status;
    const retryable = status === 429 || status === 503 || (status ?? 0) >= 500;
    if (!retryable) throw error;

    const hinted = (error as { retryAfter?: number }).retryAfter;
    const waitMs = Math.min(
      Number.isFinite(hinted) ? (hinted as number) * 1000 : 3_000,
      8_000,
    );

    await sleep(waitMs);
    return fetchOnce(url);
  }
}

/** fast-xml-parser hands back a value, an object with #text, or an array. */
function text(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === "object") {
    const record = node as Record<string, unknown>;
    if ("#text" in record) return text(record["#text"]);
    if ("@_href" in record) return String(record["@_href"]);
  }
  return "";
}

type XmlNode = Record<string, unknown>;

function asArray(value: unknown): XmlNode[] {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]) as XmlNode[];
}

function firstUrlIn(html: string): string | null {
  const match = html.match(/href=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function extractImage(entry: Record<string, unknown>): string | null {
  const enclosure = entry["enclosure"] as Record<string, unknown> | undefined;
  if (enclosure?.["@_url"] && String(enclosure["@_type"] ?? "").startsWith("image")) {
    return String(enclosure["@_url"]);
  }

  const media = asArray(entry["media:content"])[0];
  if (media?.["@_url"]) return String(media["@_url"]);

  const thumb = asArray(entry["media:thumbnail"])[0];
  if (thumb?.["@_url"]) return String(thumb["@_url"]);

  const description = text(entry["description"]) || text(entry["content"]);
  const imgMatch = description.match(/<img[^>]+src=["']([^"']+)["']/i);
  return imgMatch ? imgMatch[1] : null;
}

/**
 * Google News wraps every link in a redirector and appends " - Publisher" to
 * the headline. Recover both so the candidate carries the real publisher.
 */
function unwrapGoogleNews(
  entry: Record<string, unknown>,
  rawTitle: string,
  rawLink: string,
): { title: string; url: string; publisher: string | null } {
  const publisher = text(entry["source"]) || null;

  let title = rawTitle;
  if (publisher && title.endsWith(` - ${publisher}`)) {
    title = title.slice(0, -(publisher.length + 3)).trim();
  } else {
    title = title.replace(/\s+-\s+[^-]{2,40}$/, "").trim() || rawTitle;
  }

  // The description block usually contains a direct link to the publisher.
  const description = text(entry["description"]);
  const direct = firstUrlIn(description);
  const url =
    direct && !direct.includes("news.google.com") ? direct : rawLink;

  return { title, url, publisher };
}

/** Reddit entries link to the comments page; the article link is in the body. */
function unwrapReddit(
  entry: Record<string, unknown>,
  rawLink: string,
): { url: string; discussionUrl: string } {
  const content = text(entry["content"]);
  const links = [...content.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const outbound = links.find(
    (link) =>
      !link.includes("reddit.com") &&
      !link.includes("redd.it") &&
      link.startsWith("http"),
  );

  return { url: outbound ?? rawLink, discussionUrl: rawLink };
}

export interface FeedResult {
  source: SourceRow;
  candidates: Candidate[];
  ok: boolean;
  error?: string;
}

/** Fetches and parses one source into normalised candidates. */
export async function fetchSource(source: SourceRow): Promise<FeedResult> {
  try {
    const xml = await fetchText(source.url);
    const parsed = parser.parse(xml) as Record<string, any>;

    const channel = parsed?.rss?.channel ?? parsed?.["rdf:RDF"] ?? parsed?.feed;
    if (!channel) throw new Error("Unrecognised feed format");

    const entries: Record<string, unknown>[] = [
      ...asArray(channel.item),
      ...asArray(channel.entry),
    ];

    const candidates: Candidate[] = [];

    for (const entry of entries) {
      const rawTitle = stripHtml(text(entry["title"]));
      let rawLink = text(entry["link"]) || text(entry["guid"]);

      // Atom puts the URL on <link href="...">, sometimes across several links.
      if (!rawLink.startsWith("http")) {
        const links = asArray(entry["link"]);
        const alternate =
          links.find((l) => l?.["@_rel"] === "alternate") ?? links[0];
        rawLink = String(alternate?.["@_href"] ?? "");
      }

      if (!rawTitle || !rawLink.startsWith("http")) continue;

      let title = rawTitle;
      let url = rawLink;
      let sourceName = source.name;

      if (source.kind === "google_news") {
        const unwrapped = unwrapGoogleNews(entry, rawTitle, rawLink);
        title = unwrapped.title;
        url = unwrapped.url;
        if (unwrapped.publisher) sourceName = unwrapped.publisher;
      } else if (source.kind === "reddit") {
        url = unwrapReddit(entry, rawLink).url;
        try {
          sourceName = `${new URL(url).hostname.replace(/^www\./, "")} (via ${source.name})`;
        } catch {
          sourceName = source.name;
        }
      }

      const summaryRaw =
        text(entry["description"]) ||
        text(entry["summary"]) ||
        text(entry["content:encoded"]) ||
        text(entry["content"]);

      const canonical = canonicalUrl(url);

      candidates.push({
        title,
        url,
        canonicalUrl: canonical,
        urlHash: hashUrl(canonical),
        titleKey: titleKey(title),
        summary: stripHtml(summaryRaw).slice(0, 800),
        imageUrl: extractImage(entry),
        publishedAt:
          parseDate(text(entry["pubDate"])) ??
          parseDate(text(entry["published"])) ??
          parseDate(text(entry["updated"])) ??
          parseDate(text(entry["dc:date"])),
        sourceName,
        sourceBeat: source.beat,
        sourceWeight: source.weight,
      });
    }

    return { source, candidates, ok: true };
  } catch (error) {
    return {
      source,
      candidates: [],
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Minimum gap between two requests to the same host, to avoid 429s. */
const HOST_GAP_MS = 1_500;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Fetches every source with a bounded concurrency window, while spacing out
 * requests that share a host -- several Reddit feeds firing at once is what
 * gets the whole batch rate-limited.
 */
export async function fetchAllSources(
  sources: SourceRow[],
  concurrency = 8,
): Promise<FeedResult[]> {
  const results: FeedResult[] = [];
  const queue = [...sources];
  const lastHitAt = new Map<string, number>();

  async function worker() {
    while (queue.length) {
      const source = queue.shift();
      if (!source) break;

      const host = hostOf(source.url);
      const since = Date.now() - (lastHitAt.get(host) ?? 0);
      if (since < HOST_GAP_MS) await sleep(HOST_GAP_MS - since);
      lastHitAt.set(host, Date.now());

      results.push(await fetchSource(source));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, sources.length) }, worker),
  );

  return results;
}
