"use client";

import { useEffect, useState } from "react";

interface Status {
  status: "queued" | "generating" | "publishing" | "published" | "failed";
  error: string | null;
  editUrl: string | null;
  previewUrl: string | null;
  wpStatus: string | null;
  title: string | null;
  excerpt: string | null;
  wordCount: number | null;
  editorNotes: string[];
}

const STAGES = [
  { key: "queued", label: "Reading your answers" },
  { key: "generating", label: "Writing the piece" },
  { key: "publishing", label: "Saving to WordPress" },
  { key: "published", label: "Ready for review" },
];

const ORDER = ["queued", "generating", "publishing", "published"];

export function StatusWatcher({
  token,
  submissionId,
}: {
  token: string;
  submissionId: string;
}) {
  const [state, setState] = useState<Status | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const response = await fetch(
          `/api/submissions/${submissionId}?token=${encodeURIComponent(token)}`,
          { cache: "no-store" },
        );

        if (!response.ok) throw new Error(String(response.status));

        const data = (await response.json()) as Status;
        if (cancelled) return;

        setState(data);
        setUnreachable(false);

        if (data.status !== "published" && data.status !== "failed") {
          timer = setTimeout(poll, 4_000);
        }
      } catch {
        if (cancelled) return;
        setUnreachable(true);
        timer = setTimeout(poll, 8_000);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [submissionId, token]);

  const current = state?.status ?? "queued";
  const currentIndex = ORDER.indexOf(current);
  const done = current === "published";
  const failed = current === "failed";

  return (
    <div className="mt-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
        {done ? "Draft ready" : failed ? "Something went wrong" : "Writing"}
      </p>

      <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight">
        {state?.title ??
          (failed ? "We could not finish this one" : "Building your article")}
      </h1>

      {!failed && !done ? (
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-ink-soft)]">
          This usually takes a minute or two. You can close this tab — the draft
          link is emailed to you either way.
        </p>
      ) : null}

      {state?.excerpt ? (
        <p className="mt-4 border-l-2 border-[var(--color-accent)] pl-4 text-[15px] leading-relaxed text-[var(--color-ink-soft)]">
          {state.excerpt}
        </p>
      ) : null}

      {!failed ? (
        <ol className="mt-8 space-y-px overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
          {STAGES.map((stage, index) => {
            const reached = currentIndex >= index;
            const active = currentIndex === index && !done;

            return (
              <li
                key={stage.key}
                className="flex items-center gap-3 border-b border-[var(--color-line)] px-5 py-3.5 last:border-b-0"
              >
                <span
                  className={
                    "grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold " +
                    (reached
                      ? "bg-[var(--color-accent)] text-white"
                      : "bg-[var(--color-canvas)] text-[var(--color-muted)]")
                  }
                >
                  {reached && !active ? "✓" : index + 1}
                </span>
                <span
                  className={
                    "text-sm " +
                    (active
                      ? "font-semibold"
                      : reached
                        ? "text-[var(--color-ink-soft)]"
                        : "text-[var(--color-muted)]")
                  }
                >
                  {stage.label}
                  {active ? <span className="ml-1 animate-pulse">…</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {failed ? (
        <div className="mt-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
          <p className="text-sm leading-relaxed text-[var(--color-ink-soft)]">
            Your answers are saved, so nothing is lost. An editor can re-run this
            from the dashboard.
          </p>
          {state?.error ? (
            <pre className="mt-3 overflow-x-auto rounded-lg bg-[var(--color-canvas)] p-3 text-xs leading-relaxed text-[var(--color-muted)]">
              {state.error}
            </pre>
          ) : null}
        </div>
      ) : null}

      {done && state ? (
        <div className="mt-8">
          <div className="flex flex-wrap gap-3">
            {state.editUrl ? (
              <a
                href={state.editUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-lg bg-[var(--color-accent)] px-6 py-3 text-sm font-semibold text-white"
              >
                Open in WordPress &rarr;
              </a>
            ) : null}
            {state.previewUrl ? (
              <a
                href={state.previewUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-6 py-3 text-sm font-semibold"
              >
                Preview
              </a>
            ) : null}
          </div>

          <p className="mt-4 text-sm text-[var(--color-muted)]">
            Saved as <strong>{state.wpStatus}</strong>
            {state.wordCount ? ` · ${state.wordCount} words` : ""}. It is not live
            until you publish it.
          </p>

          {state.editorNotes.length ? (
            <div className="mt-6 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-muted)]">
                Check before publishing
              </p>
              <ul className="mt-3 space-y-2">
                {state.editorNotes.map((note, index) => (
                  <li
                    key={index}
                    className="flex gap-2 text-sm leading-relaxed text-[var(--color-ink-soft)]"
                  >
                    <span className="text-[var(--color-accent)]">&bull;</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {unreachable ? (
        <p className="mt-4 text-sm text-[var(--color-muted)]">
          Lost connection — still trying…
        </p>
      ) : null}
    </div>
  );
}
