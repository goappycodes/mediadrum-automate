export const dynamic = "force-static";

const STEPS = [
  {
    n: "01",
    title: "Scrape",
    body: "Every morning the pipeline pulls dozens of feeds — publisher RSS, Google News standing queries, Reddit — and drops anything already covered or already pitched.",
  },
  {
    n: "02",
    title: "Commission",
    body: "The best two dozen get read in full. An editor model picks the five where a MediaDrumWorld writer with an opinion could add something that does not exist yet.",
  },
  {
    n: "03",
    title: "Ask",
    body: "Each story arrives by email with an angle and five or six questions built to pull out the writer's own experience and judgement.",
  },
  {
    n: "04",
    title: "Draft",
    body: "The author's answers become the spine of the piece. The source story supplies the facts; the take supplies the reason it deserves to rank.",
  },
  {
    n: "05",
    title: "Review",
    body: "The draft lands in WordPress under the author's byline, unpublished, with editor notes flagging anything a human must check.",
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
        MediaDrumWorld
      </p>

      <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight">
        The newsroom automation
      </h1>

      <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[var(--color-ink-soft)]">
        This app finds the stories worth writing about, asks the author what they
        actually think, and turns their answer into a draft. It publishes nothing
        on its own.
      </p>

      <ol className="mt-12 space-y-px overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
        {STEPS.map((step) => (
          <li
            key={step.n}
            className="flex gap-5 border-b border-[var(--color-line)] p-6 last:border-b-0"
          >
            <span className="mt-0.5 shrink-0 font-mono text-xs text-[var(--color-muted)]">
              {step.n}
            </span>
            <div>
              <h2 className="text-sm font-semibold">{step.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-10 text-sm text-[var(--color-muted)]">
        Authors reach their brief through the link emailed to them each morning.
        Editors manage sources, recipients and failed runs from{" "}
        <a
          href="/admin"
          className="font-medium text-[var(--color-accent)] underline underline-offset-4"
        >
          the dashboard
        </a>
        .
      </p>
    </main>
  );
}
