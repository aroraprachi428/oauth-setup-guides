// App names come from the public search box. They are only ever data: used as a search
// term and a slug, never interpolated into agent instructions unquoted.

const MAX_LENGTH = 60;
// Letters (any script), digits, spaces and a few name punctuation marks.
const ALLOWED = /^[\p{L}\p{N} .&+'()\-_/]+$/u;

export type NormalizedName = { ok: true; name: string; slug: string } | { ok: false; reason: string };

export function normalizeAppName(input: string): NormalizedName {
  const name = input.trim().replace(/\s+/g, " ");
  if (name.length === 0) return { ok: false, reason: "Enter an app name." };
  if (name.length > MAX_LENGTH) return { ok: false, reason: `Keep it under ${MAX_LENGTH} characters.` };
  if (/[\u0000-\u001f\u007f]/.test(input) || !ALLOWED.test(name)) {
    return { ok: false, reason: "Use letters, numbers and simple punctuation only." };
  }
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return { ok: false, reason: "Use letters or numbers in the name." };
  return { ok: true, name, slug };
}
