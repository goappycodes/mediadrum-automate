"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { DigestItemRow } from "@/lib/types";

const TONES = [
  { value: "punchy-first-person", label: "Punchy first person", hint: "Direct and opinionated. You are on the page from line one." },
  { value: "reported-with-voice", label: "Reported, with your voice", hint: "Mostly third person; you step in for the judgements." },
  { value: "analytical", label: "Analytical", hint: "Argued step by step rather than asserted." },
  { value: "warm", label: "Warm", hint: "Leads with the people; your take arrives through empathy." },
];

const LENGTHS = [700, 900, 1200];

/** A rough gauge of whether there is enough here to build an article from. */
function depthOf(answers: string[]): { words: number; label: string; tone: string } {
  const words = answers.join(" ").trim().split(/\s+/).filter(Boolean).length;

  if (words < 60) {
    return { words, label: "Too thin — the draft will read generic", tone: "text-[var(--color-accent)]" };
  }
  if (words < 150) {
    return { words, label: "Workable, but more detail makes a better piece", tone: "text-[var(--color-muted)]" };
  }
  return { words, label: "Plenty to build on", tone: "text-[var(--color-ink-soft)]" };
}

export function WriteForm({
  token,
  item,
  authorName,
}: {
  token: string;
  item: DigestItemRow;
  authorName: string;
}) {
  const router = useRouter();

  const [answers, setAnswers] = useState<string[]>(() =>
    item.questions.map(() => ""),
  );
  const [headline, setHeadline] = useState(item.headline_options[0] ?? "");
  const [customHeadline, setCustomHeadline] = useState("");
  const [tone, setTone] = useState(TONES[0].value);
  const [targetWords, setTargetWords] = useState(900);
  const [extraNotes, setExtraNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const depth = useMemo(() => depthOf([...answers, extraNotes]), [answers, extraNotes]);
  const answered = answers.filter((answer) => answer.trim().length > 0).length;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (answered === 0) {
      setError("Answer at least one question — your take is the article.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          itemId: item.id,
          answers: item.questions.map((question, index) => ({
            question: question.question,
            answer: answers[index] ?? "",
          })),
          extraNotes: extraNotes.trim() || undefined,
          chosenHeadline: (customHeadline.trim() || headline) || undefined,
          tone,
          targetWords,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        setSubmitting(false);
        return;
      }

      router.push(`/brief/${token}/status/${data.submissionId}`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  const field =
    "w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-3 text-[15px] leading-relaxed " +
    "placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none";

  return (
    <form onSubmit={submit} className="mt-10">
      <div className="space-y-8">
        {item.questions.map((question, index) => (
          <div key={question.id}>
            <label
              htmlFor={question.id}
              className="block text-[15px] font-semibold leading-snug"
            >
              <span className="mr-2 font-mono text-xs text-[var(--color-muted)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              {question.question}
            </label>

            <p className="mt-1.5 pl-7 text-sm leading-relaxed text-[var(--color-muted)]">
              {question.why}
            </p>

            <textarea
              id={question.id}
              value={answers[index]}
              onChange={(event) => {
                const next = [...answers];
                next[index] = event.target.value;
                setAnswers(next);
              }}
              rows={4}
              placeholder={question.placeholder}
              className={`${field} mt-3 min-h-28 resize-y`}
            />
          </div>
        ))}
      </div>

      <fieldset className="mt-10 border-t border-[var(--color-line)] pt-8">
        <legend className="sr-only">Article options</legend>

        <label className="block text-[15px] font-semibold">Headline</label>
        <p className="mt-1.5 text-sm text-[var(--color-muted)]">
          Pick one, or write your own.
        </p>
        <div className="mt-3 space-y-2">
          {item.headline_options.map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5 has-checked:border-[var(--color-accent)] has-checked:bg-[var(--color-accent-soft)]"
            >
              <input
                type="radio"
                name="headline"
                value={option}
                checked={headline === option && !customHeadline}
                onChange={() => {
                  setHeadline(option);
                  setCustomHeadline("");
                }}
                className="mt-1 accent-[var(--color-accent)]"
              />
              <span className="text-sm leading-snug">{option}</span>
            </label>
          ))}
        </div>
        <input
          type="text"
          value={customHeadline}
          onChange={(event) => setCustomHeadline(event.target.value)}
          placeholder="Or write your own headline"
          className={`${field} mt-2`}
        />

        <label className="mt-8 block text-[15px] font-semibold">Tone</label>
        <div className="mt-3 space-y-2">
          {TONES.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5 has-checked:border-[var(--color-accent)] has-checked:bg-[var(--color-accent-soft)]"
            >
              <input
                type="radio"
                name="tone"
                value={option.value}
                checked={tone === option.value}
                onChange={() => setTone(option.value)}
                className="mt-1 accent-[var(--color-accent)]"
              />
              <span>
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="mt-0.5 block text-sm text-[var(--color-muted)]">
                  {option.hint}
                </span>
              </span>
            </label>
          ))}
        </div>

        <label className="mt-8 block text-[15px] font-semibold">Length</label>
        <div className="mt-3 flex gap-2">
          {LENGTHS.map((length) => (
            <button
              key={length}
              type="button"
              onClick={() => setTargetWords(length)}
              className={
                "rounded-lg border px-4 py-2 text-sm font-medium " +
                (targetWords === length
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "border-[var(--color-line)] bg-[var(--color-surface)]")
              }
            >
              ~{length} words
            </button>
          ))}
        </div>

        <label
          htmlFor="extra"
          className="mt-8 block text-[15px] font-semibold"
        >
          Anything else
        </label>
        <p className="mt-1.5 text-sm text-[var(--color-muted)]">
          A detail you want in, a line you want used, someone to avoid naming.
        </p>
        <textarea
          id="extra"
          value={extraNotes}
          onChange={(event) => setExtraNotes(event.target.value)}
          rows={3}
          className={`${field} mt-3 min-h-20 resize-y`}
        />
      </fieldset>

      <div className="sticky bottom-0 mt-10 -mx-6 border-t border-[var(--color-line)] bg-[var(--color-canvas)]/95 px-6 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className={`text-sm ${depth.tone}`}>
            {answered}/{item.questions.length} answered &middot; {depth.words} words
            &middot; {depth.label}
          </p>

          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-[var(--color-accent)] px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Sending…" : "Write it up"}
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-sm font-medium text-[var(--color-accent)]">{error}</p>
        ) : null}

        <p className="mt-2 text-xs text-[var(--color-muted)]">
          The draft is saved to WordPress under {authorName}&rsquo;s byline,
          unpublished, for review.
        </p>
      </div>
    </form>
  );
}
