import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let cached: SupabaseClient | null = null;

/**
 * Service-role client. Server-side only -- this key bypasses RLS, so it must
 * never be imported into a client component or exposed to the browser.
 */
export function db(): SupabaseClient {
  if (!cached) {
    cached = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

type LogScope = "discover" | "curate" | "generate" | "publish" | "email";

/** Fire-and-forget audit line. Never throws -- logging must not break a run. */
export async function log(
  scope: LogScope,
  level: "info" | "warn" | "error",
  message: string,
  detail?: unknown,
  runId?: string,
): Promise<void> {
  const line = `[${scope}] ${message}`;
  if (level === "error") console.error(line, detail ?? "");
  else if (level === "warn") console.warn(line, detail ?? "");
  else console.log(line, detail ?? "");

  try {
    await db().from("run_logs").insert({
      run_id: runId ?? null,
      scope,
      level,
      message,
      detail: detail === undefined ? null : JSON.parse(JSON.stringify(detail)),
    });
  } catch {
    // Swallow: the console line above is the fallback.
  }
}
