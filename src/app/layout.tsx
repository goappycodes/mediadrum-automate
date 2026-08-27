import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MediaDrum Newsroom",
  description:
    "Daily story briefs, author interviews, and automated drafting for MediaDrumWorld.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
