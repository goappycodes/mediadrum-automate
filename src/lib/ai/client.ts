import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";

let cached: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!cached) {
    cached = new Anthropic({
      apiKey: env.anthropicKey,
      // Vercel functions cap at 300s; leave headroom to surface a real error.
      timeout: 280_000,
      maxRetries: 2,
    });
  }
  return cached;
}

/**
 * Opus 5 can decline a request on policy grounds. Server-side fallbacks re-run
 * the same request on a fallback model inside the same call, so a single
 * borderline story does not kill the whole daily run.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
