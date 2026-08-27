import type { Candidate, SiteProfile } from "../types";
import { titleKey, titleSimilarity } from "./normalize";

/**
 * Cheap heuristic pre-ranking. Its only job is to cut a few hundred feed items
 * down to a few dozen worth reading in full -- the actual editorial judgement
 * happens in the curation model call afterwards.
 */

/** Headline shapes that historically travel well on this site. */
const HOOK_PATTERNS: { pattern: RegExp; points: number; label: string }[] = [
  { pattern: /\b(rare|rarest|only known|one of a kind)\b/i, points: 3, label: "rarity" },
  { pattern: /\b(discovered|unearthed|uncovered|found after|resurfaced)\b/i, points: 3, label: "discovery" },
  { pattern: /\b(abandoned|derelict|forgotten|lost)\b/i, points: 3, label: "abandoned" },
  { pattern: /\b(first ever|world's (first|largest|oldest|smallest))\b/i, points: 3, label: "superlative" },
  // Deliberately narrow: bare "transformation" matches corporate press releases.
  { pattern: /\b(weight[- ]loss|body transformation|before and after|lost \d+\s?(st|stone|lbs?|kg|pounds)|makeover|gastric)\b/i, points: 3, label: "transformation" },
  { pattern: /\b(sparks (debate|outrage|fury)|divides|backlash|slammed)\b/i, points: 2, label: "controversy" },
  { pattern: /\b(mum|dad|mother|father|gran|couple|teen|woman|man) (who|has|says|reveals)\b/i, points: 3, label: "human-interest" },
  { pattern: /\b(secret|hidden|untold|never before seen)\b/i, points: 2, label: "secrecy" },
  { pattern: /\b(survived|survivor|escaped|rescued|miracle)\b/i, points: 3, label: "survival" },
  { pattern: /\b(banned|illegal|forbidden|censored)\b/i, points: 2, label: "taboo" },
  { pattern: /\b(quit|left|gave up) (my |their |his |her )?(job|career|home)\b/i, points: 3, label: "life-change" },
  { pattern: /\b\d{2,}[-\s]?(year|stone|mile|foot|ft|kg|lb)\b/i, points: 2, label: "concrete-number" },
  { pattern: /\b(photographs?|photos?|images?|pictures?|footage)\b/i, points: 2, label: "visual" },
];

/** Commodity news this site does not compete on. */
const PENALTY_PATTERNS: { pattern: RegExp; points: number; label: string }[] = [
  { pattern: /\b(shares? (rise|fall|slip|jump)|ftse|nasdaq|earnings call|q[1-4] results)\b/i, points: -6, label: "markets" },
  { pattern: /\b(live updates?|as it happened|live blog|latest updates)\b/i, points: -8, label: "liveblog" },
  { pattern: /\b(full time|match report|final score|\d+-\d+ (win|loss|draw))\b/i, points: -6, label: "match-report" },
  { pattern: /\b(opinion|editorial|comment|letters?):/i, points: -3, label: "already-opinion" },
  { pattern: /\b(what to watch|best deals|deal of the day|discount code|voucher)\b/i, points: -8, label: "commerce" },
  { pattern: /\b(weather forecast|traffic|road closures)\b/i, points: -6, label: "service" },
  { pattern: /\b(crossword|quiz|puzzle|horoscope|wordle)\b/i, points: -8, label: "puzzle" },
  { pattern: /\b(dies? aged|obituary|death notice)\b/i, points: -2, label: "obituary" },
  // Football/transfer churn scores deceptively well on "number + visual" signals.
  { pattern: /\b(transfer (news|window|target|deal)|£\d+m (striker|midfielder|defender|move|bid)|should have signed|linked with a move)\b/i, points: -9, label: "transfer-gossip" },
  { pattern: /\b(premier league|championship|la liga|serie a|snooker|darts|f1|nba|nfl)\b.*\b(win|beat|loss|clash|tie|fixture|squad|lineup)\b/i, points: -7, label: "sports-churn" },
  { pattern: /\b(star (explains|reveals|admits|hits back)|slams? (rival|club|manager))\b/i, points: -5, label: "sports-quote" },
  { pattern: /\b(says|said|explains|reveals|insists|admits)\b.{0,60}\b(win|defeat|victory|loss|match|fixture|final|title race)\b/i, points: -6, label: "result-quote" },
  // Corporate press releases masquerade as human-interest copy remarkably well.
  { pattern: /\b(appoints?|names?)\b.{0,40}\b(as (its |the )?(new )?)?(chief|head of|director|president|ceo|cfo|cto|leader|advisor|officer)\b/i, points: -10, label: "appointment-pr" },
  { pattern: /\b(announces|unveils|launches)\b.{0,30}\b(partnership|platform|solution|integration|initiative|milestone|suite|programme|program|funding round)\b/i, points: -10, label: "corporate-pr" },
  { pattern: /\b(digital|business|technology|enterprise|ai[- ]driven) transformation\b/i, points: -12, label: "corporate-jargon" },
  { pattern: /\b(b2b|saas|end[- ]to[- ]end solution|thought leadership|synerg|stakeholder engagement)/i, points: -8, label: "jargon" },
];

/**
 * Topics we do not hand to an automated pipeline for a hot take.
 *
 * This is a blunt instrument on purpose. The cost of wrongly skipping a story
 * is that a human never sees it in one morning's brief; the cost of wrongly
 * keeping one is a tasteless opinion piece about a real person's worst day.
 * The site can and does cover crime and tragedy -- just not through this door.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // Violent crime, especially fresh cases and live proceedings
  /\b(murder|murdered|homicide|manslaughter|killing spree|massacre)\b/i,
  /\b(stabb(ed|ing)|shot dead|gunned down|mass shooting|shooting spree)\b/i,
  /\b(rape|raped|sexual assault|sexually abused|indecent (assault|images))\b/i,
  /\b(child (abuse|sexual|grooming)|csam|grooming gang|paedophil)/i,
  /\b(charged with|pleaded (guilty|not guilty)|found guilty|sentenced to|on trial|court heard|jailed for)\b/i,
  /\b(terror(ism|ist)? (attack|plot)|beheaded|hostage)\b/i,
  // Self-harm and bereavement
  /\b(suicide|took (his|her|their) own life|self[- ]harm|died by suicide)\b/i,
  /\b(body (was )?found|remains identified|missing (girl|boy|child|toddler))\b/i,
  /\b(fatal|fatally|died after|dead after|death crash|house fire|killed in a?\s?(crash|fire|collision))\b/i,
  // Live humanitarian crises
  /\b(genocide|ethnic cleansing|war crimes|famine declared)\b/i,
];

function hoursSince(iso: string | null): number {
  if (!iso) return 48; // unknown timestamps are treated as middling-fresh
  const ms = Date.now() - new Date(iso).getTime();
  return ms < 0 ? 0 : ms / 3_600_000;
}

function recencyScore(hours: number): number {
  if (hours <= 6) return 10;
  if (hours <= 12) return 8;
  if (hours <= 24) return 6;
  if (hours <= 48) return 3;
  if (hours <= 72) return 1;
  return -4;
}

function keywordScore(text: string, keywords: string[]): number {
  const haystack = text.toLowerCase();
  let hits = 0;
  for (const keyword of keywords) {
    if (keyword.length < 4) continue;
    if (haystack.includes(keyword)) hits += 1;
    if (hits >= 5) break;
  }
  return hits * 1.5;
}

export interface ScoredCandidate extends Candidate {
  score: number;
  scoreReasons: string[];
  sensitive: boolean;
}

export function scoreCandidate(
  candidate: Candidate,
  profile: SiteProfile,
): ScoredCandidate {
  const reasons: string[] = [];
  const haystack = `${candidate.title} ${candidate.summary}`;

  const hours = hoursSince(candidate.publishedAt);
  let score = recencyScore(hours);
  reasons.push(`recency:${Math.round(hours)}h`);

  for (const { pattern, points, label } of HOOK_PATTERNS) {
    if (pattern.test(haystack)) {
      score += points;
      reasons.push(`+${label}`);
    }
  }

  for (const { pattern, points, label } of PENALTY_PATTERNS) {
    if (pattern.test(haystack)) {
      score += points;
      reasons.push(`-${label}`);
    }
  }

  const keywordPoints = keywordScore(haystack, profile.keywords);
  if (keywordPoints > 0) {
    score += keywordPoints;
    reasons.push(`+beat-match(${keywordPoints.toFixed(1)})`);
  }

  if (candidate.imageUrl) {
    score += 1.5;
    reasons.push("+has-image");
  }

  // Very short headlines are usually stubs or index pages.
  if (candidate.title.length < 25) {
    score -= 3;
    reasons.push("-thin-headline");
  }

  score *= candidate.sourceWeight;

  const sensitive = SENSITIVE_PATTERNS.some((pattern) => pattern.test(haystack));
  if (sensitive) reasons.push("!sensitive");

  return { ...candidate, score, scoreReasons: reasons, sensitive };
}

export interface DedupeContext {
  /** url_hash values we have already considered on a previous day. */
  seenUrlHashes: Set<string>;
  /** title_key values from the dedupe ledger. */
  seenTitleKeys: string[];
  /** Headlines already published on the site. */
  publishedTitles: string[];
}

/**
 * Removes stories we have already pitched, already published, or that appear
 * multiple times across syndicating feeds. Keeps the highest scorer of each
 * near-duplicate cluster.
 */
export function dedupe(
  candidates: ScoredCandidate[],
  context: DedupeContext,
): { kept: ScoredCandidate[]; dropped: number } {
  const publishedKeys = context.publishedTitles.map(titleKey);
  const kept: ScoredCandidate[] = [];
  let dropped = 0;

  const byScore = [...candidates].sort((a, b) => b.score - a.score);

  for (const candidate of byScore) {
    if (context.seenUrlHashes.has(candidate.urlHash)) {
      dropped += 1;
      continue;
    }

    const alreadyPitched = context.seenTitleKeys.some(
      (key) => titleSimilarity(key, candidate.titleKey) >= 0.72,
    );
    if (alreadyPitched) {
      dropped += 1;
      continue;
    }

    const alreadyPublished = publishedKeys.some(
      (key) => titleSimilarity(key, candidate.titleKey) >= 0.55,
    );
    if (alreadyPublished) {
      dropped += 1;
      continue;
    }

    const duplicateInBatch = kept.some(
      (other) =>
        other.canonicalUrl === candidate.canonicalUrl ||
        titleSimilarity(other.titleKey, candidate.titleKey) >= 0.6,
    );
    if (duplicateInBatch) {
      dropped += 1;
      continue;
    }

    kept.push(candidate);
  }

  return { kept, dropped };
}

/** The hook that earned a candidate its points, used as a coarse topic proxy. */
function topicOf(candidate: ScoredCandidate): string | null {
  const hook = candidate.scoreReasons.find((reason) => reason.startsWith("+"));
  return hook && hook !== "+has-image" && !hook.startsWith("+beat-match")
    ? hook
    : null;
}

/**
 * Caps how much of the shortlist any one beat, publisher, or topic can take.
 *
 * All three caps earn their keep. Without the source cap, one high-volume feed
 * crowds everything out because volume and score correlate. Without the topic
 * cap, a standing query like "weight loss" returns five versions of the same
 * story from five outlets and burns half the shortlist on one idea.
 */
export function diversify(
  candidates: ScoredCandidate[],
  limit: number,
  perBeat = 5,
  perSource = 3,
  perTopic = 3,
): ScoredCandidate[] {
  const beatCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  const result: ScoredCandidate[] = [];

  for (const candidate of candidates) {
    const beatUsed = beatCounts.get(candidate.sourceBeat) ?? 0;
    if (beatUsed >= perBeat) continue;

    const sourceKey = candidate.sourceName.toLowerCase();
    const sourceUsed = sourceCounts.get(sourceKey) ?? 0;
    if (sourceUsed >= perSource) continue;

    const topic = topicOf(candidate);
    const topicUsed = topic ? (topicCounts.get(topic) ?? 0) : 0;
    if (topic && topicUsed >= perTopic) continue;

    beatCounts.set(candidate.sourceBeat, beatUsed + 1);
    sourceCounts.set(sourceKey, sourceUsed + 1);
    if (topic) topicCounts.set(topic, topicUsed + 1);
    result.push(candidate);

    if (result.length >= limit) break;
  }

  return result;
}
