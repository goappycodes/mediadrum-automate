import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { resolveToken } from "@/lib/tokens";
import type { DigestItemRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BriefPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolveToken(token);

  if (!resolved) {
    return (
      <main className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">This link has expired</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-soft)]">
          Briefs stay open for seven days. Tomorrow morning&rsquo;s email will
          have a fresh set of stories.
        </p>
      </main>
    );
  }

  const { digest, author } = resolved;

  const { data: itemRows } = await db()
    .from("digest_items")
    .select("*")
    .eq("digest_id", digest.id)
    .order("position");

  const items = (itemRows ?? []) as DigestItemRow[];
  if (items.length === 0) notFound();

  const { data: claims } = await db()
    .from("submissions")
    .select("digest_item_id, status, author_id")
    .in(
      "digest_item_id",
      items.map((item) => item.id),
    )
    .in("status", ["queued", "generating", "publishing", "published"]);

  const claimed = new Map(
    (claims ?? []).map((claim) => [claim.digest_item_id, claim]),
  );

  const date = new Date(`${digest.run_date}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <header className="border-b border-[var(--color-line)] pb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Daily brief &middot; {date}
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight">
          Morning, {author.name.split(" ")[0]}
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--color-ink-soft)]">
          {items.length} stories where your take would be worth reading. Pick
          one, answer the questions, and the draft lands in WordPress under your
          byline for you to review.
        </p>
      </header>

      <div className="mt-10 space-y-6">
        {items.map((item, index) => {
          const claim = claimed.get(item.id);
          const mine = claim?.author_id === author.id;

          return (
            <article
              key={item.id}
              className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]"
            >
              <div className="p-6">
                <div className="flex items-baseline gap-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">
                  <span className="font-mono">{String(index + 1).padStart(2, "0")}</span>
                  <span>{item.source_name}</span>
                  {item.suggested_category ? (
                    <span className="rounded bg-[var(--color-canvas)] px-2 py-0.5 tracking-normal">
                      {item.suggested_category}
                    </span>
                  ) : null}
                </div>

                <h2 className="mt-3 text-xl font-bold leading-snug tracking-tight">
                  {item.angle_title}
                </h2>

                <p className="mt-2.5 text-[15px] leading-relaxed text-[var(--color-ink-soft)]">
                  {item.angle_pitch}
                </p>

                <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted)]">
                  <span className="font-semibold text-[var(--color-ink-soft)]">
                    Why it fits:{" "}
                  </span>
                  {item.why_it_fits}
                </p>

                <div className="mt-5 rounded-lg bg-[var(--color-canvas)] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">
                    The story it comes from
                  </p>
                  <p className="mt-1.5 text-sm font-medium leading-snug">
                    {item.source_headline}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                    {item.factual_summary}
                  </p>
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-2.5 inline-block text-sm font-medium text-[var(--color-accent)] underline underline-offset-4"
                  >
                    Read the original &rarr;
                  </a>
                </div>

                <details className="mt-4 group">
                  <summary className="cursor-pointer list-none text-sm font-semibold text-[var(--color-ink-soft)]">
                    <span className="group-open:hidden">
                      Show the {item.questions.length} questions &darr;
                    </span>
                    <span className="hidden group-open:inline">Hide questions &uarr;</span>
                  </summary>
                  <ol className="mt-3 space-y-2 border-l-2 border-[var(--color-line)] pl-4">
                    {item.questions.map((question) => (
                      <li key={question.id} className="text-sm leading-relaxed">
                        {question.question}
                      </li>
                    ))}
                  </ol>
                </details>
              </div>

              <div className="border-t border-[var(--color-line)] bg-[var(--color-canvas)] px-6 py-4">
                {claim ? (
                  <p className="text-sm text-[var(--color-muted)]">
                    {mine
                      ? `You have already claimed this one (${claim.status}).`
                      : "Another author has claimed this story."}
                  </p>
                ) : (
                  <Link
                    href={`/brief/${token}/write/${item.id}`}
                    className="inline-block rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-white"
                  >
                    Write this one &rarr;
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <p className="mt-10 text-xs leading-relaxed text-[var(--color-muted)]">
        Nothing here publishes itself. Every draft is created unpublished for you
        to read, edit and approve.
      </p>
    </main>
  );
}
