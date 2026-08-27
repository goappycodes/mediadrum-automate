import { isAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/supabase";
import { AdminControls, RetryButton, ToggleSwitch } from "./controls";

export const dynamic = "force-dynamic";

function when(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

function LoginForm({ failed }: { failed: boolean }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
        MediaDrumWorld
      </p>
      <h1 className="mt-3 text-2xl font-bold">Newsroom dashboard</h1>

      <form action="/api/admin/login" method="post" className="mt-6">
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoFocus
          required
          className="mt-2 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-3 text-[15px] focus:border-[var(--color-accent)] focus:outline-none"
        />
        {failed ? (
          <p className="mt-2 text-sm font-medium text-[var(--color-accent)]">
            That password is not right.
          </p>
        ) : null}
        <button
          type="submit"
          className="mt-4 w-full rounded-lg bg-[var(--color-accent)] px-5 py-3 text-sm font-semibold text-white"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}

function Section({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold uppercase tracking-[0.1em]">{title}</h2>
        {meta ? (
          <span className="text-xs text-[var(--color-muted)]">{meta}</span>
        ) : null}
      </div>
      <div className="mt-3 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
        {children}
      </div>
    </section>
  );
}

const STATUS_TONE: Record<string, string> = {
  sent: "text-emerald-600",
  published: "text-emerald-600",
  running: "text-amber-600",
  generating: "text-amber-600",
  publishing: "text-amber-600",
  queued: "text-amber-600",
  failed: "text-[var(--color-accent)]",
  empty: "text-[var(--color-muted)]",
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  if (!(await isAdmin())) {
    return <LoginForm failed={error === "1"} />;
  }

  const [digests, submissions, sources, authors, logs] = await Promise.all([
    db().from("digests").select("*").order("started_at", { ascending: false }).limit(10),
    db()
      .from("submissions")
      .select("*, digest_items(angle_title, source_name), authors(name)")
      .order("created_at", { ascending: false })
      .limit(15),
    db().from("sources").select("*").order("name"),
    db().from("authors").select("*").order("name"),
    db()
      .from("run_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const sourceRows = sources.data ?? [];
  const failing = sourceRows.filter(
    (source) => source.enabled && source.last_status && source.last_status !== "ok",
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-line)] pb-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            MediaDrumWorld
          </p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            Newsroom dashboard
          </h1>
        </div>
        <AdminControls />
      </header>

      <Section
        title="Recent runs"
        meta={`${digests.data?.length ?? 0} shown`}
      >
        {(digests.data ?? []).length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-muted)]">
            No runs yet. Use &ldquo;Run discovery now&rdquo; above.
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {(digests.data ?? []).map((digest) => (
                <tr
                  key={digest.id}
                  className="border-b border-[var(--color-line)] last:border-b-0"
                >
                  <td className="px-5 py-3 font-medium">{digest.run_date}</td>
                  <td
                    className={`px-5 py-3 font-semibold ${STATUS_TONE[digest.status] ?? ""}`}
                  >
                    {digest.status}
                  </td>
                  <td className="px-5 py-3 text-[var(--color-muted)]">
                    {digest.candidates_scanned} scanned · {digest.candidates_kept} unique
                    · {digest.sources_ok}/{digest.sources_ok + digest.sources_failed} sources
                  </td>
                  <td className="px-5 py-3 text-right text-[var(--color-muted)]">
                    {when(digest.started_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {(digests.data ?? []).some((d) => d.error) ? (
          <div className="border-t border-[var(--color-line)] bg-[var(--color-canvas)] px-5 py-3">
            {(digests.data ?? [])
              .filter((d) => d.error)
              .slice(0, 3)
              .map((d) => (
                <p key={d.id} className="text-xs leading-relaxed text-[var(--color-accent)]">
                  {d.run_date}: {d.error}
                </p>
              ))}
          </div>
        ) : null}
      </Section>

      <Section title="Submissions">
        {(submissions.data ?? []).length === 0 ? (
          <p className="p-5 text-sm text-[var(--color-muted)]">
            Nothing written yet.
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {(submissions.data ?? []).map((submission) => (
                <tr
                  key={submission.id}
                  className="border-b border-[var(--color-line)] last:border-b-0 align-top"
                >
                  <td className="px-5 py-3">
                    <div className="font-medium">
                      {submission.generated?.title ??
                        submission.digest_items?.angle_title ??
                        "—"}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                      {submission.authors?.name} · {when(submission.created_at)}
                    </div>
                    {submission.error ? (
                      <div className="mt-1 text-xs text-[var(--color-accent)]">
                        {submission.error}
                      </div>
                    ) : null}
                  </td>
                  <td
                    className={`px-5 py-3 font-semibold ${STATUS_TONE[submission.status] ?? ""}`}
                  >
                    {submission.status}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {submission.wp_edit_url ? (
                      <a
                        href={submission.wp_edit_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-[var(--color-accent)] underline underline-offset-4"
                      >
                        Open draft
                      </a>
                    ) : submission.status === "failed" ? (
                      <RetryButton submissionId={submission.id} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title="Authors"
        meta={`${(authors.data ?? []).filter((a) => a.active).length} receiving the brief`}
      >
        <table className="w-full text-sm">
          <tbody>
            {(authors.data ?? []).map((author) => (
              <tr
                key={author.id}
                className="border-b border-[var(--color-line)] last:border-b-0"
              >
                <td className="px-5 py-3 font-medium">{author.name}</td>
                <td className="px-5 py-3 text-[var(--color-muted)]">
                  {author.email}
                </td>
                <td className="px-5 py-3 text-[var(--color-muted)]">
                  wp #{author.wp_user_id} · saves as {author.publish_status}
                </td>
                <td className="px-5 py-3 text-right">
                  <ToggleSwitch
                    table="authors"
                    id={author.id}
                    value={author.active}
                    onLabel="Emailing"
                    offLabel="Paused"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Sources"
        meta={
          failing.length
            ? `${failing.length} failing · ${sourceRows.filter((s) => s.enabled).length} enabled`
            : `${sourceRows.filter((s) => s.enabled).length} enabled`
        }
      >
        <table className="w-full text-sm">
          <tbody>
            {sourceRows.map((source) => (
              <tr
                key={source.id}
                className="border-b border-[var(--color-line)] last:border-b-0"
              >
                <td className="px-5 py-2.5">
                  <div className="font-medium">{source.name}</div>
                  <div className="text-xs text-[var(--color-muted)]">
                    {source.beat} · weight {source.weight}
                  </div>
                </td>
                <td className="px-5 py-2.5 text-xs">
                  {source.last_status === "ok" ? (
                    <span className="text-[var(--color-muted)]">
                      {source.last_item_count} items · {when(source.last_fetched_at)}
                    </span>
                  ) : source.last_status ? (
                    <span className="text-[var(--color-accent)]">
                      {source.last_status}
                    </span>
                  ) : (
                    <span className="text-[var(--color-muted)]">not fetched yet</span>
                  )}
                </td>
                <td className="px-5 py-2.5 text-right">
                  <ToggleSwitch
                    table="sources"
                    id={source.id}
                    value={source.enabled}
                    onLabel="On"
                    offLabel="Off"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Log">
        <div className="max-h-80 overflow-y-auto">
          {(logs.data ?? []).map((entry) => (
            <div
              key={entry.id}
              className="flex gap-3 border-b border-[var(--color-line)] px-5 py-2 text-xs last:border-b-0"
            >
              <span className="shrink-0 font-mono text-[var(--color-muted)]">
                {when(entry.created_at)}
              </span>
              <span
                className={
                  "shrink-0 font-semibold uppercase " +
                  (entry.level === "error"
                    ? "text-[var(--color-accent)]"
                    : entry.level === "warn"
                      ? "text-amber-600"
                      : "text-[var(--color-muted)]")
                }
              >
                {entry.scope}
              </span>
              <span className="leading-relaxed">{entry.message}</span>
            </div>
          ))}
        </div>
      </Section>
    </main>
  );
}
