import { NextResponse, type NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { db } from "@/lib/supabase";
import { whoami } from "@/lib/wordpress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Setup check: confirms every external dependency is wired up correctly. */
export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  const configured = (name: string) => ({
    ok: Boolean(process.env[name]),
    detail: process.env[name] ? "set" : "missing",
  });

  checks.TOKEN_SECRET = configured("TOKEN_SECRET");
  checks.CRON_SECRET = configured("CRON_SECRET");
  checks.ADMIN_PASSWORD = configured("ADMIN_PASSWORD");
  checks.ANTHROPIC_API_KEY = configured("ANTHROPIC_API_KEY");
  checks.RESEND_API_KEY = configured("RESEND_API_KEY");

  try {
    const { count, error } = await db()
      .from("sources")
      .select("id", { count: "exact", head: true })
      .eq("enabled", true);

    if (error) throw new Error(error.message);
    checks.supabase = { ok: true, detail: `${count ?? 0} enabled sources` };
  } catch (error) {
    checks.supabase = { ok: false, detail: String(error) };
  }

  try {
    const user = await whoami();
    checks.wordpress = {
      ok: true,
      detail: `authenticated as ${user.name} (${user.roles.join(", ")})`,
    };
  } catch (error) {
    checks.wordpress = { ok: false, detail: String(error) };
  }

  const ok = Object.values(checks).every((check) => check.ok);
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
