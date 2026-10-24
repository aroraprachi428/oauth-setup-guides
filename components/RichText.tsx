import type { ReactNode } from "react";
import { Icon } from "./Icon";

// Presentation only: applies docs conventions (bold UI paths, code font, short links)
// to guide text without changing its words.

// Leading word → callout label, as in docs style guides. Vocabulary only.
const CALLOUTS: [RegExp, "Optional" | "Important"][] = [
  [/^(optional|optionally)\b/i, "Optional"],
  [/^(leave|don't|do not|never|avoid|only|without)\b/i, "Important"],
];

function callout(text: string) {
  return CALLOUTS.find(([re]) => re.test(text.trim()))?.[1];
}

const URL = String.raw`https?:\/\/[^\s)]+[^\s).,;:]`;
const SEGMENT = String.raw`[A-Z][\w&'-]*(?: [A-Z][\w&'-]*)*`;
const CRUMBS = String.raw`${SEGMENT}(?: ?[>›] ?${SEGMENT})+`;
const CODE = String.raw`\b(?:GET|POST|PUT|PATCH|DELETE)\b|\b[a-z][a-z0-9]+(?:[_.:][a-z0-9]+)+\b(?:=[^\s,;)]+)?|\b[a-z][a-z0-9_]*=[\w.-]+|\{[^{}]*\}`;
const TOKEN = new RegExp(`((?<=^|\\s)\\((?:[^()]|\\([^()]*\\))*\\))|(${URL})|(${CRUMBS})|(${CODE})`, "g");

function shortUrl(url: string) {
  try {
    const u = new globalThis.URL(url);
    const path = u.pathname.length > 28 ? `${u.pathname.slice(0, 26)}…` : u.pathname;
    return `${u.host.replace(/^www\./, "")}${path === "/" ? "" : path}`;
  } catch {
    return url;
  }
}

export function Rich({ text, brief = false }: { text: string; brief?: boolean }): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const [whole, paren, url, crumbs, code] = m;
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = m.index;
    if (paren && brief) {
      // Brief mode drops asides ("More detail" shows them) and the space before them.
      const prev = out[out.length - 1];
      if (typeof prev === "string") out[out.length - 1] = prev.trimEnd();
    } else if (paren) {
      out.push(
        <span key={key} className="aside">
          ({<Rich text={paren.slice(1, -1)} />})
        </span>,
      );
    } else if (url) {
      out.push(
        <a key={key} className="inline-link" href={url} rel="noreferrer" target="_blank" title={url}>
          {shortUrl(url)}
          <Icon name="external" />
        </a>,
      );
    } else if (crumbs) {
      const parts = crumbs.split(/ ?[>›] ?/);
      out.push(
        <b key={key} className="ui-path">
          {parts.map((p, i) => (
            <span key={i}>
              {i > 0 && <span className="ui-path__sep"> › </span>}
              {p}
            </span>
          ))}
        </b>,
      );
    } else if (code) {
      out.push(<code key={key}>{code}</code>);
    } else {
      out.push(whole);
    }
    last = m.index + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

// First sentence is the headline; the rest is fine print.
export function splitHeadline(text: string): [string, string] {
  const m = /^(.+?[.;!?])\s+(?=[A-Z"(])(.*)$/s.exec(text);
  return m ? [m[1], m[2]] : [text, ""];
}

// A numbered procedure: first sentence is the step, the rest is supporting detail (hidden when brief).
export function InstructionList({ lines, brief = false }: { lines: string[]; brief?: boolean }) {
  return (
    <ol className="procedure">
      {lines.map((line, i) => {
        const tag = callout(line);
        // The label already says "Optional", so drop a leading "Optional:" from the text.
        const body = tag === "Optional" ? line.replace(/^optional:\s*/i, "") : line;
        const [head, rest] = splitHeadline(body.charAt(0).toUpperCase() + body.slice(1));
        return (
          <li key={i} className={`procedure__step${tag ? ` procedure__step--${tag.toLowerCase()}` : ""}`}>
            <p className="procedure__head">
              {tag && <span className={`tag-label tag-label--${tag.toLowerCase()}`}>{tag}</span>}
              <Rich text={head} brief={brief} />
            </p>
            {rest && !brief && (
              <p className="procedure__rest">
                <Rich text={rest} />
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
