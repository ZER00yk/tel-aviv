import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
// Each rendered document receives a fresh request CSP nonce.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: {
    default: "Tell Aviv — your shared space",
    template: "%s · Tell Aviv",
  },
  description: "A shared space for friends, games, creations, and classes.",
  applicationName: "Tell Aviv",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
