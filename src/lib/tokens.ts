import "server-only";
import crypto from "node:crypto";
import { env } from "./env";
import { db } from "./supabase";
import type { AuthorRow, DigestRow } from "./types";

/**
 * Author magic links.
 *
 * The token itself is `base64url(payload).hmac`. The payload is only an
 * identifier pair -- the HMAC proves we minted it, and the `author_tokens` row
 * proves it has not expired or been revoked. Both checks must pass.
 */

interface TokenPayload {
  d: string; // digest id
  a: string; // author id
}

function sign(data: string): string {
  return crypto
    .createHmac("sha256", env.tokenSecret)
    .update(data)
    .digest("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function mintToken(digestId: string, authorId: string): string {
  const payload: TokenPayload = { d: digestId, a: authorId };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function verifySignature(token: string): TokenPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof parsed?.d === "string" && typeof parsed?.a === "string") {
      return parsed as TokenPayload;
    }
  } catch {
    /* fall through */
  }
  return null;
}

export interface ResolvedToken {
  digest: DigestRow;
  author: AuthorRow;
  token: string;
}

/**
 * Validates a magic-link token end to end and returns the digest + author it
 * belongs to. Returns null for anything malformed, expired, or unknown.
 */
export async function resolveToken(
  token: string,
): Promise<ResolvedToken | null> {
  const payload = verifySignature(token);
  if (!payload) return null;

  const { data: row } = await db()
    .from("author_tokens")
    .select("id, digest_id, author_id, expires_at, first_opened_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (!row) return null;
  if (row.digest_id !== payload.d || row.author_id !== payload.a) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  const [{ data: digest }, { data: author }] = await Promise.all([
    db().from("digests").select("*").eq("id", row.digest_id).maybeSingle(),
    db().from("authors").select("*").eq("id", row.author_id).maybeSingle(),
  ]);

  if (!digest || !author) return null;

  if (!row.first_opened_at) {
    await db()
      .from("author_tokens")
      .update({ first_opened_at: new Date().toISOString() })
      .eq("id", row.id);
  }

  return {
    digest: digest as DigestRow,
    author: author as AuthorRow,
    token,
  };
}

/** Creates (or replaces) the magic link for one author on one digest. */
export async function issueToken(
  digestId: string,
  authorId: string,
): Promise<string> {
  const token = mintToken(digestId, authorId);
  const expiresAt = new Date(
    Date.now() + env.tokenTtlDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  await db().from("author_tokens").upsert(
    {
      digest_id: digestId,
      author_id: authorId,
      token_hash: hashToken(token),
      expires_at: expiresAt,
    },
    { onConflict: "digest_id,author_id" },
  );

  return token;
}
