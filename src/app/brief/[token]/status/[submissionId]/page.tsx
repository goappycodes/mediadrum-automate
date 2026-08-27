import Link from "next/link";
import { resolveToken } from "@/lib/tokens";
import { StatusWatcher } from "./watcher";

export const dynamic = "force-dynamic";

export default async function StatusPage({
  params,
}: {
  params: Promise<{ token: string; submissionId: string }>;
}) {
  const { token, submissionId } = await params;
  const resolved = await resolveToken(token);

  if (!resolved) {
    return (
      <main className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">This link has expired</h1>
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

      <StatusWatcher token={token} submissionId={submissionId} />
    </main>
  );
}
