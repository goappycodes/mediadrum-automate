import { NextResponse, type NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { db } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Enables/disables one author or one source. */
export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    table?: "authors" | "sources";
    id?: string;
    value?: boolean;
  };

  if (!body.id || (body.table !== "authors" && body.table !== "sources")) {
    return NextResponse.json({ error: "table and id are required." }, { status: 400 });
  }

  const column = body.table === "authors" ? "active" : "enabled";

  const { error } = await db()
    .from(body.table)
    .update({ [column]: Boolean(body.value) })
    .eq("id", body.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
