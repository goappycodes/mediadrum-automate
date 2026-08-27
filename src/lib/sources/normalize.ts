import crypto from "node:crypto";

/** Tracking parameters that change per-visit and would defeat URL dedupe. */
const JUNK_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_[ce]id$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^cmp$/i,
  /^CMP$/,
  /^at_(medium|campaign|custom\d)$/i,
  /^ito$/i,
  /^oc$/i,
  /^smid$/i,
  /^s_kwcid$/i,
];

export function canonicalUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    url.hash = "";
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");

    for (const key of [...url.searchParams.keys()]) {
      if (JUNK_PARAMS.some((pattern) => pattern.test(key))) {
        url.searchParams.delete(key);
      }
    }

    // Trailing slash is not meaningful for article URLs.
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");

    return url.toString();
  } catch {
    return raw.trim();
  }
}

export function hashUrl(url: string): string {
  return crypto.createHash("sha256").update(canonicalUrl(url)).digest("hex");
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "at", "by", "from", "as", "is", "are", "was", "were", "be", "been", "it",
  "its", "this", "that", "these", "those", "he", "she", "they", "his", "her",
  "their", "you", "your", "i", "we", "our", "has", "have", "had", "will",
  "would", "can", "could", "after", "over", "into", "than", "then", "so",
  "says", "said", "new", "up", "out", "how", "why", "what", "who", "when",
]);

/**
 * A normalised fingerprint of a headline. Two syndications of the same story
 * usually share most content words, so comparing sorted content-word sets
 * catches near-duplicates that a URL check misses.
 */
export function titleKey(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/&[a-z#0-9]+;/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

  return [...new Set(words)].sort().slice(0, 10).join("-");
}

/** Jaccard overlap of two title keys, used for fuzzy near-duplicate checks. */
export function titleSimilarity(a: string, b: string): number {
  const setA = new Set(a.split("-").filter(Boolean));
  const setB = new Set(b.split("-").filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;

  let shared = 0;
  for (const word of setA) if (setB.has(word)) shared += 1;

  return shared / (setA.size + setB.size - shared);
}

export function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:apos|#39|#8217|rsquo);/g, "'")
    .replace(/&(?:mdash|#8212);/g, "-")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
