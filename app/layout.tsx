import type { Metadata } from "next";
import Link from "next/link";
import { Analytics } from "@vercel/analytics/next";
import "@/styles/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "OAuth Setup Guides",
  description: "How to set up a provider OAuth app and what stands between your first token and real users.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/">OAuth Setup Guides</Link>
        </header>
        <main className="container">{children}</main>
        <Analytics />
      </body>
    </html>
  );
}
