/** Shared row + payload shapes. Kept hand-written so the DB stays the source of truth. */

export type Beat =
  | "lifestyle"
  | "world"
  | "history"
  | "travel"
  | "nature"
  | "technology"
  | "business"
  | "curiosity"
  | "sport-gaming"
  | "food"
  | "politics";

export interface SourceRow {
  id: string;
  name: string;
  kind: "rss" | "google_news" | "reddit";
  url: string;
  beat: string;
  weight: number;
  enabled: boolean;
  last_fetched_at: string | null;
  last_status: string | null;
  last_item_count: number;
}

export interface AuthorRow {
  id: string;
  name: string;
  email: string;
  wp_user_id: number;
  beats: string[];
  active: boolean;
  publish_status: "draft" | "pending" | "publish";
}

export interface SiteProfile {
  categories: { id: number; name: string; slug: string; count: number }[];
  top_tags: { name: string; count: number }[];
  recent_titles: string[];
  keywords: string[];
  refreshed_at: string | null;
}

/** A story as pulled off a feed, before ranking. */
export interface Candidate {
  title: string;
  url: string;
  canonicalUrl: string;
  urlHash: string;
  titleKey: string;
  summary: string;
  imageUrl: string | null;
  publishedAt: string | null;
  sourceName: string;
  sourceBeat: string;
  sourceWeight: number;
  /** Populated only for candidates that survive pre-ranking. */
  fullText?: string;
  score?: number;
  scoreReasons?: string[];
}

export interface BriefQuestion {
  id: string;
  question: string;
  why: string;
  placeholder: string;
}

export interface SeoBrief {
  primary_keyword: string;
  secondary_keywords: string[];
  search_intent: string;
  meta_description: string;
}

export interface DigestItemRow {
  id: string;
  digest_id: string;
  position: number;
  source_headline: string;
  source_name: string;
  source_url: string;
  source_published_at: string | null;
  image_url: string | null;
  factual_summary: string;
  key_facts: string[];
  source_excerpt: string | null;
  angle_title: string;
  angle_pitch: string;
  why_it_fits: string;
  headline_options: string[];
  questions: BriefQuestion[];
  suggested_category: string | null;
  suggested_tags: string[];
  seo: SeoBrief;
}

export interface DigestRow {
  id: string;
  run_date: string;
  status: "running" | "sent" | "failed" | "empty";
  candidates_scanned: number;
  candidates_kept: number;
  sources_ok: number;
  sources_failed: number;
  model: string | null;
  error: string | null;
  started_at: string;
  sent_at: string | null;
}

export interface GeneratedArticle {
  title: string;
  slug: string;
  excerpt: string;
  meta_description: string;
  html: string;
  tags: string[];
  category: string;
  featured_image_brief: string;
  editor_notes: string[];
  word_count: number;
}

export interface SubmissionRow {
  id: string;
  digest_item_id: string;
  author_id: string;
  answers: { question: string; answer: string }[];
  extra_notes: string | null;
  chosen_headline: string | null;
  tone: string;
  target_words: number;
  status: "queued" | "generating" | "publishing" | "published" | "failed";
  error: string | null;
  generated: GeneratedArticle | null;
  wp_post_id: number | null;
  wp_edit_url: string | null;
  wp_preview_url: string | null;
  wp_status: string | null;
  created_at: string;
  updated_at: string;
}
