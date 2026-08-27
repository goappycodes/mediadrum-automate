import "server-only";
import { env } from "../env";
import { db, log } from "../supabase";
import { createPost, resolveCategoryId, resolveTagIds } from "../wordpress";
import { extractArticle } from "../sources/extract";
import { writeArticle } from "../ai/write";
import { renderPublishedEmail } from "../email/templates";
import { sendEmail } from "../email/send";
import type {
  AuthorRow,
  DigestItemRow,
  GeneratedArticle,
  SiteProfile,
  SubmissionRow,
} from "../types";

export interface PublishResult {
  submissionId: string;
  status: "published" | "failed";
  wpPostId?: number;
  editUrl?: string;
  previewUrl?: string;
  wpStatus?: string;
  title?: string;
  editorNotes?: string[];
  error?: string;
  durationMs: number;
}

async function fail(
  submissionId: string,
  message: string,
  startedAt: number,
): Promise<PublishResult> {
  await log("publish", "error", `Submission ${submissionId} failed`, { message });
  await db()
    .from("submissions")
    .update({ status: "failed", error: message.slice(0, 2_000) })
    .eq("id", submissionId);

  return {
    submissionId,
    status: "failed",
    error: message,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Turns a submitted questionnaire into a WordPress draft.
 *
 * Deliberately end-to-end and synchronous: generate, publish, notify. Called
 * from the submission route after the response has been returned to the author,
 * and re-runnable from /admin if it fails.
 */
export async function generateAndPublish(
  submissionId: string,
): Promise<PublishResult> {
  const startedAt = Date.now();

  const { data: submissionRow } = await db()
    .from("submissions")
    .select("*")
    .eq("id", submissionId)
    .maybeSingle();

  if (!submissionRow) {
    return {
      submissionId,
      status: "failed",
      error: "Submission not found.",
      durationMs: Date.now() - startedAt,
    };
  }

  const submission = submissionRow as SubmissionRow;

  if (submission.status === "published") {
    return {
      submissionId,
      status: "published",
      wpPostId: submission.wp_post_id ?? undefined,
      editUrl: submission.wp_edit_url ?? undefined,
      previewUrl: submission.wp_preview_url ?? undefined,
      wpStatus: submission.wp_status ?? undefined,
      title: submission.generated?.title,
      durationMs: Date.now() - startedAt,
    };
  }

  const [{ data: itemRow }, { data: authorRow }, { data: profileRow }] =
    await Promise.all([
      db().from("digest_items").select("*").eq("id", submission.digest_item_id).maybeSingle(),
      db().from("authors").select("*").eq("id", submission.author_id).maybeSingle(),
      db().from("site_profile").select("*").eq("id", 1).maybeSingle(),
    ]);

  if (!itemRow) return fail(submissionId, "The story brief no longer exists.", startedAt);
  if (!authorRow) return fail(submissionId, "The author record no longer exists.", startedAt);

  const item = itemRow as DigestItemRow;
  const author = authorRow as AuthorRow;
  const profile = (profileRow ?? {
    categories: [],
    top_tags: [],
    recent_titles: [],
    keywords: [],
    refreshed_at: null,
  }) as SiteProfile;

  // ---- 1. Draft the article -------------------------------------------------
  let article: GeneratedArticle;
  let lint: string[] = [];

  try {
    await db()
      .from("submissions")
      .update({ status: "generating", error: null })
      .eq("id", submissionId);

    // Prefer the text captured at discovery time; re-fetch only if it is missing.
    let sourceText = item.source_excerpt;
    if (!sourceText) {
      const extracted = await extractArticle(item.source_url);
      sourceText = extracted.ok ? extracted.text : null;
    }

    const result = await writeArticle({
      item,
      authorName: author.name,
      answers: submission.answers,
      extraNotes: submission.extra_notes,
      chosenHeadline: submission.chosen_headline,
      tone: submission.tone,
      targetWords: submission.target_words,
      profile,
      sourceText,
    });

    lint = result.lint;
    article = {
      title: result.title,
      slug: result.slug,
      excerpt: result.excerpt,
      meta_description: result.meta_description,
      html: result.html,
      tags: result.tags,
      category: result.category,
      featured_image_brief: result.featured_image_brief,
      editor_notes: [...result.editor_notes, ...result.lint],
      word_count: result.word_count,
    };

    await db()
      .from("submissions")
      .update({ generated: article, status: "publishing" })
      .eq("id", submissionId);

    await log("publish", "info", `Drafted "${article.title}" (${article.word_count} words)`, { usage: result.usage, lint: result.lint });
  } catch (error) {
    return fail(
      submissionId,
      `Article generation failed: ${error instanceof Error ? error.message : String(error)}`,
      startedAt,
    );
  }

  // ---- 2. Push it to WordPress ---------------------------------------------
  try {
    const [categoryId, tagIds] = await Promise.all([
      resolveCategoryId(article.category ?? item.suggested_category),
      resolveTagIds(article.tags),
    ]);

    const status = author.publish_status ?? env.wpDefaultStatus;

    const post = await createPost({
      title: article.title,
      html: article.html,
      excerpt: article.excerpt,
      slug: article.slug,
      status,
      authorWpId: author.wp_user_id,
      categoryId,
      tagIds,
      metaDescription: article.meta_description,
      focusKeyword: item.seo?.primary_keyword,
    });

    const editorNotes = post.metaWritten
      ? article.editor_notes
      : [
          ...article.editor_notes,
          `Rank Math meta could not be written over the API -- paste the meta description manually: "${article.meta_description}"`,
        ];

    await db()
      .from("submissions")
      .update({
        status: "published",
        wp_post_id: post.id,
        wp_edit_url: post.editUrl,
        wp_preview_url: post.previewUrl,
        wp_status: post.status,
        generated: { ...article, editor_notes: editorNotes },
        error: null,
      })
      .eq("id", submissionId);

    await log("publish", "info", `Created WordPress post ${post.id} (${post.status}) for ${author.name}`);

    // ---- 3. Tell the author ------------------------------------------------
    const email = renderPublishedEmail({
      authorName: author.name,
      article: { ...article, editor_notes: editorNotes },
      editUrl: post.editUrl,
      previewUrl: post.previewUrl,
      status: post.status,
      sourceUrl: item.source_url,
      sourceName: item.source_name,
      editorNotes,
    });

    await sendEmail({
      to: author.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    return {
      submissionId,
      status: "published",
      wpPostId: post.id,
      editUrl: post.editUrl,
      previewUrl: post.previewUrl,
      wpStatus: post.status,
      title: article.title,
      editorNotes,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    // The draft itself is saved on the submission, so nothing is lost -- the
    // run can be retried from /admin once the WordPress problem is fixed.
    return fail(
      submissionId,
      `WordPress publish failed: ${error instanceof Error ? error.message : String(error)}`,
      startedAt,
    );
  }
}
