"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function AdminControls() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(force: boolean) {
    setRunning(true);
    setMessage("Scraping, ranking and commissioning — this takes a few minutes.");

    try {
      const response = await fetch(`/api/admin/run${force ? "?force=1" : ""}`, {
        method: "POST",
      });
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error ?? "The run failed.");
      } else if (data.status === "skipped") {
        setMessage("Today's brief already went out. Use 'Force re-run' to redo it.");
      } else if (data.status === "empty") {
        setMessage("Nothing new cleared the bar today.");
      } else if (data.status === "failed") {
        setMessage(data.error ?? "The run failed.");
      } else {
        const sent = data.emailed?.filter((e: { ok: boolean }) => e.ok).length ?? 0;
        setMessage(
          `Done: ${data.shortlisted} stories from ${data.scanned} scanned, emailed to ${sent}.`,
        );
      }

      router.refresh();
    } catch (error) {
      setMessage(`Could not reach the server: ${String(error)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button
          onClick={() => run(false)}
          disabled={running}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {running ? "Running…" : "Run discovery now"}
        </button>
        <button
          onClick={() => run(true)}
          disabled={running}
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Force re-run
        </button>
      </div>
      {message ? (
        <p className="max-w-sm text-right text-xs leading-relaxed text-[var(--color-muted)]">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function ToggleSwitch({
  table,
  id,
  value,
  onLabel,
  offLabel,
}: {
  table: "authors" | "sources";
  id: string;
  value: boolean;
  onLabel: string;
  offLabel: string;
}) {
  const router = useRouter();
  const [on, setOn] = useState(value);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next);

    startTransition(async () => {
      const response = await fetch("/api/admin/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table, id, value: next }),
      });

      if (!response.ok) setOn(!next);
      router.refresh();
    });
  }

  return (
    <button
      onClick={toggle}
      disabled={pending}
      className={
        "rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50 " +
        (on
          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : "bg-[var(--color-canvas)] text-[var(--color-muted)]")
      }
    >
      {on ? onLabel : offLabel}
    </button>
  );
}

export function RetryButton({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "error">("idle");

  async function retry() {
    setState("running");

    const response = await fetch("/api/admin/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId }),
    });

    setState(response.ok ? "idle" : "error");
    router.refresh();
  }

  return (
    <button
      onClick={retry}
      disabled={state === "running"}
      className="rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
    >
      {state === "running" ? "Retrying…" : state === "error" ? "Failed again" : "Retry"}
    </button>
  );
}
