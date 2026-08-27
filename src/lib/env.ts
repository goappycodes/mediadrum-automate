import "server-only";

/**
 * Environment access. Everything is read lazily so that a missing variable
 * fails at request time with a clear message, rather than at build time.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  // App
  get appUrl() {
    const explicit = process.env.APP_URL;
    if (explicit) return explicit.replace(/\/+$/, "");
    // Vercel sets this automatically on preview/production deployments.
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
      return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    }
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
    return "http://localhost:3000";
  },
  get tokenSecret() {
    return required("TOKEN_SECRET");
  },
  get cronSecret() {
    return required("CRON_SECRET");
  },
  get adminPassword() {
    return required("ADMIN_PASSWORD");
  },

  // Supabase
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseServiceKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },

  // Anthropic
  get anthropicKey() {
    return required("ANTHROPIC_API_KEY");
  },
  /**
   * Two stages, two models, because they are not the same job.
   *
   * Curation is triage over a long candidate list and runs every single day,
   * so it dominates the bill -- Sonnet handles it well at ~40% of the cost.
   * Drafting produces the actual published article, which is the one place
   * where paying for the better model is worth it, and only runs when an
   * author actually commissions something.
   *
   * `ANTHROPIC_MODEL` still overrides both, for a quick global switch.
   */
  get curationModel() {
    return (
      process.env.CURATION_MODEL ||
      process.env.ANTHROPIC_MODEL ||
      "claude-sonnet-5"
    );
  },
  get writingModel() {
    return (
      process.env.WRITING_MODEL ||
      process.env.ANTHROPIC_MODEL ||
      "claude-opus-5"
    );
  },
  get curationEffort() {
    return optional("CURATION_EFFORT", "medium") as
      | "low"
      | "medium"
      | "high"
      | "xhigh"
      | "max";
  },
  get writingEffort() {
    return optional("WRITING_EFFORT", "high") as
      | "low"
      | "medium"
      | "high"
      | "xhigh"
      | "max";
  },
  /** Characters of source text sent per candidate. The main input-cost lever. */
  get curationTextBudget() {
    return num("CURATION_TEXT_BUDGET", 1_800);
  },

  // WordPress
  get wpUrl() {
    return required("WP_URL").replace(/\/+$/, "");
  },
  get wpUsername() {
    return required("WP_USERNAME");
  },
  get wpAppPassword() {
    // WordPress prints application passwords in space-separated groups.
    return required("WP_APP_PASSWORD").replace(/\s+/g, "");
  },
  get wpDefaultStatus() {
    return optional("WP_DEFAULT_STATUS", "draft") as
      | "draft"
      | "pending"
      | "publish";
  },

  // Email
  get resendKey() {
    return required("RESEND_API_KEY");
  },
  get emailFrom() {
    return optional(
      "EMAIL_FROM",
      "MediaDrum Newsroom <newsroom@mediadrumworld.com>",
    );
  },
  get emailBcc() {
    return process.env.EMAIL_BCC || undefined;
  },
  get emailConfigured() {
    return Boolean(process.env.RESEND_API_KEY);
  },

  /**
   * Test mode redirects every outbound email to a single address, so a live
   * run can be exercised end to end without any author receiving anything.
   * Defaults to ON: switching it off has to be a deliberate act.
   */
  get emailTestMode() {
    return (process.env.EMAIL_TEST_MODE ?? "true").toLowerCase() !== "false";
  },
  get emailTestRecipient() {
    return process.env.EMAIL_TEST_RECIPIENT || "";
  },

  // Discovery tuning
  get shortlistSize() {
    return num("SHORTLIST_SIZE", 5);
  },
  get deepReadCount() {
    return num("DEEP_READ_COUNT", 20);
  },
  get maxStoryAgeHours() {
    return num("MAX_STORY_AGE_HOURS", 72);
  },
  get tokenTtlDays() {
    return num("TOKEN_TTL_DAYS", 7);
  },
};

export const USER_AGENT =
  "MediaDrumAutomate/1.0 (+https://mediadrumworld.com; editorial newsroom bot)";
