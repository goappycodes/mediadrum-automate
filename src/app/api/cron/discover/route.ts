import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { runDiscovery } from "@/lib/pipeline/discover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The daily job. Vercel Cron calls this with
 * `Authorization: Bearer $CRON_SECRET` (see vercel.json).
 *
 * `?force=1` discards today's digest and runs again -- handy while tuning.
 */
async function handle(request: NextRequest) {
  const provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.cronSecret}`;

  if (provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const force = request.nextUrl.searchParams.get("force") === "1";

  try {
    const result = await runDiscovery({ force });
    return NextResponse.json(result, {
      status: result.status === "failed" ? 500 : 200,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
