import Link from "next/link";
import { db } from "@/lib/supabase";
import { resolveToken } from "@/lib/tokens";
import type { DigestItemRow } from "@/lib/types";
import { WriteForm } from "./form";

export const dynamic = "force-dynamic";

export default async function WritePage({
  params,
}: {
  params: Promise<{ token: string; itemId: string }>;
}) {
  const { token, itemId } = await params;
  const resolved = await resolveToken(token);

  if (!resolved) {
    return (
      <main className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">This link has expired</h1>
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
          Tomorrow morning&rsquo;s brief will have a fresh set of stories.
        </p>
      </main>
    );
  }

  const { data: itemRow } = await db()
    .from("digest_items")
    .select("*")
    .eq("id", itemId)
    .eq("digest_id", resolved.digest.id)
    .maybeSingle();

  if (!itemRow) {
    return (
      <main className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">Story not found</h1>
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
          That story is not part of your brief.
        </p>
        <Link
          href={`/brief/${token}`}
          className="mt-6 inline-block text-sm font-medium text-[var(--color-accent)] underline underline-offset-4"
        >
          Back to the brief
        </Link>
      </main>
    );
  }

  const item = itemRow as DigestItemRow;

  const { data: claim } = await db()
    .from("submissions")
    .select("id, status, author_id")
    .eq("digest_item_id", item.id)
    .in("status", ["queued", "generating", "publishing", "published"])
    .maybeSingle();

  if (claim) {
    const mine = claim.author_id === resolved.author.id;
    return (
      <main className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">
          {mine ? "You have already written this one" : "Already claimed"}
        </h1>
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
          {mine
            ? "Your draft is on its way to WordPress."
            : "Another author picked this story first. Plenty left in the brief."}
        </p>
        <div className="mt-6 flex justify-center gap-4">
          {mine ? (
            <Link
              href={`/brief/${token}/status/${claim.id}`}
              className="text-sm font-medium text-[var(--color-accent)] underline underline-offset-4"
            >
              See the draft
            </Link>
          ) : null}
          <Link
            href={`/brief/${token}`}
            className="text-sm font-medium text-[var(--color-accent)] underline underline-offset-4"
          >
            Back to the brief
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-14">
      <Link
        href={`/brief/${token}`}
        className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        &larr; Back to the brief
      </Link>

      <header className="mt-6 border-b border-[var(--color-line)] pb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Your take
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight">
          {item.angle_title}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-ink-soft)]">
          {item.angle_pitch}
        </p>

        <div className="mt-5 rounded-lg bg-[var(--color-surface)] p-4 ring-1 ring-[var(--color-line)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">
            The facts, from {item.source_name}
          </p>
          <p className="mt-1.5 text-sm font-medium leading-snug">
            {item.source_headline}
          </p>
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
            {item.key_facts.map((fact, index) => (
              <li key={index} className="flex gap-2">
                <span className="text-[var(--color-muted)]">&bull;</span>
                <span>{fact}</span>
              </li>
            ))}
          </ul>
          <a
            href={item.source_url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-3 inline-block text-sm font-medium text-[var(--color-accent)] underline underline-offset-4"
          >
            Read the original before you answer &rarr;
          </a>
        </div>
      </header>

      <WriteForm token={token} item={item} authorName={resolved.author.name} />
    </main>
  );
}
