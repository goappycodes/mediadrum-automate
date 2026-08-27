import "server-only";
import { Resend } from "resend";
import { env } from "../env";
import { log } from "../supabase";

let cached: Resend | null = null;

function resend(): Resend {
  if (!cached) cached = new Resend(env.resendKey);
  return cached;
}

export interface SendResult {
  ok: boolean;
  id?: string;
  error?: string;
  skipped?: boolean;
  /** Where it actually went, which differs from `to` in test mode. */
  deliveredTo?: string;
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Banner making it unmistakable that a redirected email was not for you. */
function testBanner(intendedFor: string): string {
  return (
    `<div style="margin:0;padding:12px 16px;background:#1f2430;color:#ffd479;` +
    `font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;` +
    `line-height:1.5;text-align:center;">` +
    `<strong>TEST MODE</strong> — this email was addressed to ` +
    `<strong>${escape(intendedFor)}</strong> and redirected to you. ` +
    `They did not receive it.` +
    `</div>`
  );
}

/**
 * Sends one email. Never throws -- a failed send is recorded and returned so
 * the caller can carry on with the rest of the run.
 *
 * While `EMAIL_TEST_MODE` is on (the default), every message is redirected to
 * `EMAIL_TEST_RECIPIENT` instead of the real author, and is banner-stamped with
 * who it was meant for. If test mode is on but no recipient is configured,
 * nothing is sent at all -- the safe direction to fail in.
 */
export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  if (!env.emailConfigured) {
    await log(
      "email",
      "warn",
      `RESEND_API_KEY is not set -- skipped email to ${params.to}`,
      { subject: params.subject },
    );
    return { ok: false, skipped: true, error: "RESEND_API_KEY not configured" };
  }

  let recipient = params.to;
  let subject = params.subject;
  let html = params.html;
  let text = params.text;
  let bcc = env.emailBcc;

  if (env.emailTestMode) {
    if (!env.emailTestRecipient) {
      await log(
        "email",
        "warn",
        `Test mode is on but EMAIL_TEST_RECIPIENT is empty -- nothing sent to ${params.to}`,
        { subject: params.subject },
      );
      return {
        ok: false,
        skipped: true,
        error: "EMAIL_TEST_MODE is on with no EMAIL_TEST_RECIPIENT set",
      };
    }

    recipient = env.emailTestRecipient;
    subject = `[TEST → ${params.to}] ${params.subject}`;
    html = `${testBanner(params.to)}${params.html}`;
    text = `*** TEST MODE — addressed to ${params.to}, redirected to you. ***\n\n${params.text}`;
    bcc = undefined; // never fan out a redirected message
  }

  try {
    const { data, error } = await resend().emails.send({
      from: env.emailFrom,
      to: recipient,
      subject,
      html,
      text,
      ...(bcc ? { bcc } : {}),
    });

    if (error) {
      await log("email", "error", `Resend rejected the message to ${recipient}`, error);
      return { ok: false, error: error.message ?? String(error) };
    }

    await log(
      "email",
      "info",
      env.emailTestMode
        ? `[test] "${params.subject}" for ${params.to} redirected to ${recipient}`
        : `Sent "${params.subject}" to ${recipient}`,
      { id: data?.id },
    );

    return { ok: true, id: data?.id, deliveredTo: recipient };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await log("email", "error", `Send to ${recipient} threw`, { message });
    return { ok: false, error: message };
  }
}
