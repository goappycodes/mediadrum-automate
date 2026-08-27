import type { DigestItemRow, GeneratedArticle } from "../types";

/** Plain inline-styled HTML. Email clients ignore stylesheets and flexbox. */

const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const INK = "#16181d";
const MUTED = "#5b6472";
const LINE = "#e3e6ea";
const ACCENT = "#b3122b";

function shell(title: string, body: string, footer: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid ${LINE};border-radius:10px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
${body}
<tr><td style="padding:20px 28px;border-top:1px solid ${LINE};background:#fafbfc;color:${MUTED};font-size:12px;line-height:1.6;">
${footer}
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function header(kicker: string, heading: string, sub: string): string {
  return `<tr><td style="padding:28px 28px 8px;">
<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${ACCENT};font-weight:700;">${escape(kicker)}</div>
<h1 style="margin:8px 0 6px;font-size:23px;line-height:1.25;color:${INK};font-weight:700;">${escape(heading)}</h1>
<p style="margin:0;color:${MUTED};font-size:14px;line-height:1.55;">${escape(sub)}</p>
</td></tr>`;
}

export interface BriefEmailInput {
  authorName: string;
  runDate: string;
  items: DigestItemRow[];
  briefUrl: string;
  writeUrlFor: (itemId: string) => string;
}

export function renderBriefEmail(input: BriefEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const { authorName, items, briefUrl } = input;

  const date = new Date(`${input.runDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

  const cards = items
    .map((item, index) => {
      const questions = item.questions
        .slice(0, 6)
        .map((q) => `<li style="margin:0 0 5px;">${escape(q.question)}</li>`)
        .join("");

      return `<tr><td style="padding:0 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:8px;margin:0 0 16px;">
<tr><td style="padding:18px 20px;">

  <div style="font-size:11px;color:${MUTED};letter-spacing:.06em;text-transform:uppercase;font-weight:600;">
    ${index + 1} &nbsp;&middot;&nbsp; ${escape(item.source_name)}
  </div>

  <h2 style="margin:8px 0 4px;font-size:17px;line-height:1.3;color:${INK};font-weight:700;">
    ${escape(item.angle_title)}
  </h2>

  <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:${INK};">
    ${escape(item.angle_pitch)}
  </p>

  <div style="padding:10px 12px;background:#f7f8fa;border-radius:6px;margin:0 0 12px;">
    <div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:4px;">The story it comes from</div>
    <div style="font-size:13px;line-height:1.5;color:${INK};">${escape(item.source_headline)}</div>
    <a href="${escape(item.source_url)}" style="font-size:12px;color:${ACCENT};text-decoration:none;">Read the original &rarr;</a>
  </div>

  <div style="font-size:11px;color:${MUTED};text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:6px;">
    ${item.questions.length} questions we would ask you
  </div>
  <ul style="margin:0 0 16px;padding-left:18px;font-size:13px;line-height:1.55;color:${INK};">
    ${questions}
  </ul>

  <a href="${escape(input.writeUrlFor(item.id))}"
     style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:6px;">
    Write this one &rarr;
  </a>

</td></tr></table>
</td></tr>`;
    })
    .join("");

  const body = [
    header(
      "Daily brief",
      `${items.length} ${items.length === 1 ? "story" : "stories"} worth your take`,
      `${date} · Pick one, answer the questions, and the draft lands in WordPress under your byline.`,
    ),
    `<tr><td style="padding:16px 28px 4px;"></td></tr>`,
    cards,
    `<tr><td style="padding:4px 28px 24px;">
      <a href="${escape(briefUrl)}" style="font-size:13px;color:${ACCENT};text-decoration:none;font-weight:600;">
        Open the full brief in your browser &rarr;
      </a>
    </td></tr>`,
  ].join("");

  const footer =
    `Sent to ${escape(authorName)} by the MediaDrumWorld newsroom automation. ` +
    `Every draft is created unpublished for you to review — nothing goes live without you. ` +
    `Links in this email expire in 7 days.`;

  const text = [
    `MediaDrumWorld daily brief — ${date}`,
    "",
    ...items.map(
      (item, index) =>
        [
          `${index + 1}. ${item.angle_title}`,
          `   From: ${item.source_headline} (${item.source_name})`,
          `   ${item.angle_pitch}`,
          `   Write it: ${input.writeUrlFor(item.id)}`,
        ].join("\n"),
    ),
    "",
    `Full brief: ${briefUrl}`,
  ].join("\n\n");

  return {
    subject: `${items.length} stories worth your take — ${date}`,
    html: shell("MediaDrumWorld daily brief", body, footer),
    text,
  };
}

export interface PublishedEmailInput {
  authorName: string;
  article: GeneratedArticle;
  editUrl: string;
  previewUrl: string;
  status: string;
  sourceUrl: string;
  sourceName: string;
  editorNotes: string[];
}

export function renderPublishedEmail(input: PublishedEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const notes = input.editorNotes.length
    ? `<div style="padding:14px 16px;background:#fff8e6;border:1px solid #f0dfae;border-radius:6px;margin:0 0 18px;">
        <div style="font-size:11px;color:#8a6d1f;text-transform:uppercase;letter-spacing:.06em;font-weight:700;margin-bottom:6px;">Check before publishing</div>
        <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.6;color:${INK};">
          ${input.editorNotes.map((note) => `<li style="margin:0 0 4px;">${escape(note)}</li>`).join("")}
        </ul>
      </div>`
    : "";

  const body = [
    header(
      "Draft ready",
      input.article.title,
      `Saved to WordPress as "${input.status}" under your byline. Review it, then publish when you are happy.`,
    ),
    `<tr><td style="padding:20px 28px 8px;">

      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:${INK};">
        ${escape(input.article.excerpt)}
      </p>

      ${notes}

      <a href="${escape(input.editUrl)}"
         style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:6px;margin:0 8px 12px 0;">
        Open in WordPress &rarr;
      </a>
      <a href="${escape(input.previewUrl)}"
         style="display:inline-block;border:1px solid ${LINE};color:${INK};text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:6px;margin:0 0 12px;">
        Preview
      </a>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0;border-top:1px solid ${LINE};">
        <tr><td style="padding:14px 0 0;font-size:13px;line-height:1.7;color:${MUTED};">
          <strong style="color:${INK};">Word count</strong> ${input.article.word_count}<br>
          <strong style="color:${INK};">Category</strong> ${escape(input.article.category)}<br>
          <strong style="color:${INK};">Tags</strong> ${escape(input.article.tags.join(", "))}<br>
          <strong style="color:${INK};">Source</strong> <a href="${escape(input.sourceUrl)}" style="color:${ACCENT};text-decoration:none;">${escape(input.sourceName)}</a><br>
          <strong style="color:${INK};">Lead image brief</strong> ${escape(input.article.featured_image_brief)}
        </td></tr>
      </table>

    </td></tr>`,
  ].join("");

  const text = [
    `Your draft is ready: ${input.article.title}`,
    "",
    input.article.excerpt,
    "",
    `Edit: ${input.editUrl}`,
    `Preview: ${input.previewUrl}`,
    "",
    input.editorNotes.length
      ? `Check before publishing:\n${input.editorNotes.map((n) => `- ${n}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    subject: `Draft ready: ${input.article.title}`,
    html: shell("Your draft is ready", body, `Created for ${escape(input.authorName)} by the MediaDrumWorld newsroom automation.`),
    text,
  };
}
