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
}

/**
 * Sends one email. Never throws -- a failed send is recorded and returned so
 * the caller can carry on with the rest of the run.
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

  try {
    const { data, error } = await resend().emails.send({
      from: env.emailFrom,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      ...(env.emailBcc ? { bcc: env.emailBcc } : {}),
    });

    if (error) {
      await log("email", "error", `Resend rejected the message to ${params.to}`, error);
      return { ok: false, error: error.message ?? String(error) };
    }

    await log("email", "info", `Sent "${params.subject}" to ${params.to}`, {
      id: data?.id,
    });
    return { ok: true, id: data?.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await log("email", "error", `Send to ${params.to} threw`, { message });
    return { ok: false, error: message };
  }
}
