"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { MyRequests } from "./MyRequests";

type Item = { slug: string; name: string; card: ReactNode };

const slugify = (s: string) => s.trim().toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function LibraryBrowser({ items }: { items: Item[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const shown = q ? items.filter((i) => i.name.toLowerCase().includes(q) || i.slug.includes(slugify(q))) : items;
  const exact = q && items.some((i) => i.slug === slugify(q) || i.name.toLowerCase() === q);

  async function add() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch("/api/add", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: query }) });
      const body = await r.json();
      if (body.status === "exists") return router.push(`/guides/${body.slug}`);
      if (body.status === "queued") return router.push(`/add/${body.jobId}`);
      setMessage(body.message ?? "Couldn't add this app right now.");
    } catch {
      setMessage("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form
        className="search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (q && !exact && shown.length === 0) add();
        }}
      >
        <label htmlFor="app-search">Find an app</label>
        <input
          id="app-search"
          type="search"
          value={query}
          maxLength={60}
          placeholder="e.g. Calendly"
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setMessage(null);
          }}
        />
      </form>

      {q && !exact && (
        <div className="add-cta">
          <p>{shown.length === 0 ? `No guide for “${query.trim()}” yet.` : `Not the one you want?`}</p>
          <button type="button" onClick={add} disabled={busy}>
            {busy ? "Starting…" : `Add “${query.trim()}”`}
          </button>
          <p className="muted">An AI agent researches the app's official docs and adds a guide to the gallery if it passes our checks.</p>
        </div>
      )}
      {!q && <MyRequests />}
      {message && (
        <p role="alert" className="notice">
          {message}
        </p>
      )}

      {shown.length > 0 && (
        <ul className="grid plain">
          {shown.map((i) => (
            <li key={i.slug}>{i.card}</li>
          ))}
        </ul>
      )}
    </>
  );
}
