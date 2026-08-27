import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { resolveToken } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Status polling for the "writing your piece" screen. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ error: "Missing token." }, { status: 401 });
  }

  const resolved = await resolveToken(token);
  if (!resolved) {
    return NextResponse.json({ error: "This link has expired." }, { status: 401 });
  }

  const { data: submission } = await db()
    .from("submissions")
    .select("id, status, error, wp_edit_url, wp_preview_url, wp_status, generated, author_id")
    .eq("id", id)
    .maybeSingle();

  if (!submission || submission.author_id !== resolved.author.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({
    id: submission.id,
    status: submission.status,
    error: submission.error,
    editUrl: submission.wp_edit_url,
    previewUrl: submission.wp_preview_url,
    wpStatus: submission.wp_status,
    title: submission.generated?.title ?? null,
    excerpt: submission.generated?.excerpt ?? null,
    wordCount: submission.generated?.word_count ?? null,
    editorNotes: submission.generated?.editor_notes ?? [],
  });
}
