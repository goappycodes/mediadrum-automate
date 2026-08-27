import "server-only";
import { env, USER_AGENT } from "./env";
import type { SiteProfile } from "./types";

/**
 * Thin WordPress REST client, authenticated with an Application Password.
 *
 * Rank Math is the SEO plugin on mediadrumworld.com, so we attempt to write
 * `rank_math_*` post meta. Those keys are only writable over REST when the
 * plugin registers them; failure is logged and ignored rather than fatal.
 */

function authHeader(): string {
  const raw = `${env.wpUsername}:${env.wpAppPassword}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

async function wp<T>(
  path: string,
  init: RequestInit & { authenticated?: boolean } = {},
): Promise<T> {
  const { authenticated = true, ...rest } = init;
  const url = `${env.wpUrl}/wp-json/wp/v2${path}`;

  const response = await fetch(url, {
    ...rest,
    headers: {
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
      ...(authenticated ? { Authorization: authHeader() } : {}),
      ...rest.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `WordPress ${rest.method ?? "GET"} ${path} failed (${response.status}): ${body.slice(0, 400)}`,
    );
  }

  return (await response.json()) as T;
}

const stripHtml = (value: string) =>
  value
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&(?:quot|#34);/g, '"')
    .replace(/&(?:apos|#39|#8217);/g, "'")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

interface WpTerm {
  id: number;
  name: string;
  slug: string;
  count: number;
}

interface WpPost {
  id: number;
  link: string;
  status: string;
  title: { rendered: string };
  date: string;
}

/** Confirms the credentials work and returns the authenticated user. */
export async function whoami(): Promise<{ id: number; name: string; roles: string[] }> {
  return wp("/users/me?context=edit");
}

export async function fetchCategories(): Promise<WpTerm[]> {
  return wp<WpTerm[]>(
    "/categories?per_page=100&orderby=count&order=desc",
    { authenticated: false },
  );
}

export async function fetchTags(limit = 60): Promise<WpTerm[]> {
  return wp<WpTerm[]>(
    `/tags?per_page=${limit}&orderby=count&order=desc`,
    { authenticated: false },
  );
}

export async function fetchRecentTitles(limit = 60): Promise<string[]> {
  const posts = await wp<WpPost[]>(
    `/posts?per_page=${Math.min(limit, 100)}&orderby=date&order=desc&_fields=title,date`,
    { authenticated: false },
  );
  return posts.map((post) => stripHtml(post.title.rendered));
}

/**
 * Builds the snapshot of what the site actually publishes. Feeds the curation
 * prompt so shortlisting is grounded in this site's real beats, not a guess.
 */
export async function buildSiteProfile(): Promise<SiteProfile> {
  const [categories, tags, recentTitles] = await Promise.all([
    fetchCategories(),
    fetchTags(),
    fetchRecentTitles(),
  ]);

  const keywords = [
    ...tags.slice(0, 40).map((tag) => stripHtml(tag.name)),
    ...categories.slice(0, 15).map((category) => stripHtml(category.name)),
  ]
    .map((word) => word.toLowerCase())
    .filter((word, index, all) => word.length > 2 && all.indexOf(word) === index);

  return {
    categories: categories.map((category) => ({
      id: category.id,
      name: stripHtml(category.name),
      slug: category.slug,
      count: category.count,
    })),
    top_tags: tags.map((tag) => ({ name: stripHtml(tag.name), count: tag.count })),
    recent_titles: recentTitles,
    keywords,
    refreshed_at: new Date().toISOString(),
  };
}

/** Resolves a category by slug, then by name. Falls back to the site default. */
export async function resolveCategoryId(
  wanted: string | null,
  fallbackSlug = "latest-news",
): Promise<number | null> {
  const categories = await fetchCategories();
  const needle = (wanted ?? "").trim().toLowerCase();

  const match =
    categories.find((c) => c.slug.toLowerCase() === needle) ??
    categories.find((c) => stripHtml(c.name).toLowerCase() === needle) ??
    categories.find((c) => c.slug.toLowerCase() === fallbackSlug);

  return match?.id ?? null;
}

/** Finds existing tags by name and creates the ones that do not exist yet. */
export async function resolveTagIds(names: string[]): Promise<number[]> {
  const ids: number[] = [];

  for (const rawName of names.slice(0, 12)) {
    const name = rawName.trim();
    if (!name) continue;

    try {
      const found = await wp<WpTerm[]>(
        `/tags?search=${encodeURIComponent(name)}&per_page=20`,
        { authenticated: false },
      );
      const exact = found.find(
        (tag) => stripHtml(tag.name).toLowerCase() === name.toLowerCase(),
      );
      if (exact) {
        ids.push(exact.id);
        continue;
      }

      const created = await wp<WpTerm>("/tags", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      ids.push(created.id);
    } catch (error) {
      console.warn(`Could not resolve tag "${name}":`, error);
    }
  }

  return ids;
}

export interface CreatePostInput {
  title: string;
  html: string;
  excerpt: string;
  slug?: string;
  status: "draft" | "pending" | "publish";
  authorWpId: number;
  categoryId: number | null;
  tagIds: number[];
  metaDescription?: string;
  focusKeyword?: string;
}

export interface CreatedPost {
  id: number;
  link: string;
  status: string;
  editUrl: string;
  previewUrl: string;
  metaWritten: boolean;
}

export async function createPost(input: CreatePostInput): Promise<CreatedPost> {
  const body: Record<string, unknown> = {
    title: input.title,
    content: input.html,
    excerpt: input.excerpt,
    status: input.status,
    author: input.authorWpId,
    comment_status: "open",
  };

  if (input.slug) body.slug = input.slug;
  if (input.categoryId) body.categories = [input.categoryId];
  if (input.tagIds.length) body.tags = input.tagIds;

  const post = await wp<WpPost>("/posts", {
    method: "POST",
    body: JSON.stringify(body),
  });

  // Rank Math SEO fields, best effort.
  let metaWritten = false;
  if (input.metaDescription || input.focusKeyword) {
    try {
      await wp(`/posts/${post.id}`, {
        method: "POST",
        body: JSON.stringify({
          meta: {
            ...(input.metaDescription
              ? { rank_math_description: input.metaDescription }
              : {}),
            ...(input.focusKeyword
              ? { rank_math_focus_keyword: input.focusKeyword }
              : {}),
          },
        }),
      });
      metaWritten = true;
    } catch (error) {
      console.warn("Rank Math meta not writable over REST:", error);
    }
  }

  return {
    id: post.id,
    link: post.link,
    status: post.status,
    editUrl: `${env.wpUrl}/wp-admin/post.php?post=${post.id}&action=edit`,
    previewUrl: `${env.wpUrl}/?p=${post.id}&preview=true`,
    metaWritten,
  };
}
