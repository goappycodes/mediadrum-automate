import { NextResponse, after, type NextRequest } from "next/server";
import { z } from "zod";
import { db, log } from "@/lib/supabase";
import { resolveToken } from "@/lib/tokens";
import { generateAndPublish } from "@/lib/pipeline/publish";
import type { DigestItemRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BodySchema = z.object({
  token: z.string().min(10),
  itemId: z.string().uuid(),
  answers: z
    .array(z.object({ question: z.string().min(1), answer: z.string() }))
    .min(1),
  extraNotes: z.string().max(4_000).optional(),
  chosenHeadline: z.string().max(300).optional(),
  tone: z
    .enum(["punchy-first-person", "reported-with-voice", "analytical", "warm"])
    .default("punchy-first-person"),
  targetWords: z.number().int().min(500).max(1_800).default(900),
});

/** Creates a submission and kicks off generation after the response is sent. */
export async function POST(request: NextRequest) {
  let payload: z.infer<typeof BodySchema>;

  try {
    payload = BodySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid submission.", detail: String(error) },
      { status: 400 },
    );
  }

  const resolved = await resolveToken(payload.token);
  if (!resolved) {
    return NextResponse.json(
      { error: "This link has expired. Ask for a fresh brief." },
      { status: 401 },
    );
  }

  // The story must belong to the digest this token was issued for.
  const { data: itemRow } = await db()
    .from("digest_items")
    .select("*")
    .eq("id", payload.itemId)
    .eq("digest_id", resolved.digest.id)
    .maybeSingle();

  if (!itemRow) {
    return NextResponse.json(
      { error: "That story is not part of your brief." },
      { status: 404 },
    );
  }

  const item = itemRow as DigestItemRow;

  const answered = payload.answers.filter((entry) => entry.answer.trim().length > 0);
  if (answered.length === 0) {
    return NextResponse.json(
      { error: "Answer at least one question -- your take is the article." },
      { status: 400 },
    );
  }

  // Someone may already be writing this one.
  const { data: live } = await db()
    .from("submissions")
    .select("id, status")
    .eq("digest_item_id", item.id)
    .in("status", ["queued", "generating", "publishing", "published"])
    .maybeSingle();

  if (live) {
    return NextResponse.json(
      {
        error: "This story has already been claimed.",
        submissionId: live.id,
        status: live.status,
      },
      { status: 409 },
    );
  }

  const { data: submission, error } = await db()
    .from("submissions")
    .insert({
      digest_item_id: item.id,
      author_id: resolved.author.id,
      answers: answered,
      extra_notes: payload.extraNotes ?? null,
      chosen_headline: payload.chosenHeadline ?? null,
      tone: payload.tone,
      target_words: payload.targetWords,
      status: "queued",
    })
    .select("id")
    .single();

  if (error || !submission) {
    return NextResponse.json(
      { error: `Could not save your answers: ${error?.message}` },
      { status: 500 },
    );
  }

  await log("generate", "info", `${resolved.author.name} claimed "${item.angle_title}"`, {
    submissionId: submission.id,
  });

  // Generation takes a couple of minutes; the author watches the status page.
  after(async () => {
    try {
      await generateAndPublish(submission.id);
    } catch (error) {
      await log("generate", "error", "Background generation threw", {
        submissionId: submission.id,
        error: String(error),
      });
    }
  });

  return NextResponse.json({ submissionId: submission.id, status: "queued" });
}
