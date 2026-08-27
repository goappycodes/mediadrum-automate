import { NextResponse, type NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { db } from "@/lib/supabase";
import { generateAndPublish } from "@/lib/pipeline/publish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Re-runs a failed submission. The author's answers are already saved. */
export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { submissionId } = (await request.json()) as { submissionId?: string };
  if (!submissionId) {
    return NextResponse.json({ error: "submissionId is required." }, { status: 400 });
  }

  await db()
    .from("submissions")
    .update({ status: "queued", error: null })
    .eq("id", submissionId);

  const result = await generateAndPublish(submissionId);
  return NextResponse.json(result, {
    status: result.status === "failed" ? 500 : 200,
  });
}
