"use client";

import { useState } from "react";

const TYPES = [
  { value: "label_different", label: "A label or button is different" },
  { value: "got_error", label: "I got an error" },
  { value: "took_longer", label: "It took longer than stated" },
  { value: "missing_requirement", label: "I needed something not listed" },
  { value: "other", label: "Something else" },
];

export function ReportProblem({ slug, target }: { slug: string; target: string }) {
  const [type, setType] = useState("");
  const [detail, setDetail] = useState("");
  const [minutes, setMinutes] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!type) return;
    setState("sending");
    try {
      const r = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, target, type, detail: detail || null, minutesTaken: type === "took_longer" && minutes ? Number(minutes) : null }),
      });
      const body = await r.json();
      if (r.ok) {
        setState("sent");
        setMessage(body.status === "recheck_queued" ? "Thanks. Enough people reported this that the agent is re-checking it." : "Thanks, we've noted it.");
      } else {
        setState("error");
        setMessage(body.message ?? (r.status === 429 ? "You've sent a lot of reports today. Try again tomorrow." : "Couldn't send the report."));
      }
    } catch {
      setState("error");
      setMessage("Couldn't reach the server.");
    }
  }

  if (state === "sent") return <p className="muted report">{message}</p>;

  return (
    <details className="report">
      <summary>Report a problem</summary>
      <form onSubmit={send}>
        <label>
          What happened?
          <select value={type} onChange={(e) => setType(e.target.value)} required>
            <option value="">Choose one</option>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {type === "took_longer" && (
          <label>
            How long did it take, in minutes? (optional)
            <input type="number" min={1} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </label>
        )}
        <label>
          Details or error message (optional)
          <textarea maxLength={1000} rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </label>
        <button type="submit" disabled={!type || state === "sending"}>
          {state === "sending" ? "Sending…" : "Send"}
        </button>
        {state === "error" && <p role="alert">{message}</p>}
      </form>
    </details>
  );
}
