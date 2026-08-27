import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

/**
 * Single shared password for /admin, exchanged for a signed cookie.
 * Enough for an internal newsroom tool; swap for Supabase Auth if this ever
 * needs per-user accounts.
 */

const COOKIE = "mda_admin";
const TTL_MS = 12 * 60 * 60 * 1000;

function sign(value: string): string {
  return crypto
    .createHmac("sha256", env.tokenSecret)
    .update(`admin:${value}`)
    .digest("base64url");
}

export function issueAdminCookie(): { name: string; value: string; maxAge: number } {
  const expiry = String(Date.now() + TTL_MS);
  return {
    name: COOKIE,
    value: `${expiry}.${sign(expiry)}`,
    maxAge: TTL_MS / 1000,
  };
}

export function checkPassword(candidate: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(env.adminPassword);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isValidCookie(raw: string | undefined): boolean {
  if (!raw) return false;

  const [expiry, signature] = raw.split(".");
  if (!expiry || !signature) return false;
  if (Number(expiry) < Date.now()) return false;

  const expected = sign(expiry);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return isValidCookie(store.get(COOKIE)?.value);
}

/** Header-based check, for API routes called from the admin UI. */
export function isAdminRequest(request: Request): boolean {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`${COOKIE}=([^;]+)`));
  if (isValidCookie(match?.[1])) return true;

  // Also accept the cron secret so the same endpoints work from a terminal.
  return request.headers.get("authorization") === `Bearer ${env.cronSecret}`;
}

export const ADMIN_COOKIE = COOKIE;
