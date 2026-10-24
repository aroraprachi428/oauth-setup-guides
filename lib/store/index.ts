import { createSqliteStore } from "./sqlite";
import type { Store } from "./types";

export type { Store } from "./types";

// STORE_URL: file:./data/guides.db locally, or a libsql:// Turso URL (with STORE_AUTH_TOKEN) when hosted.
// Without STORE_URL there is no store, and the app serves curated guides only.
let cached: Promise<Store> | null = null;

export function getStore(): Promise<Store> | null {
  const url = process.env.STORE_URL;
  if (!url) return null;
  cached ??= (async () => {
    const store = createSqliteStore(url, { authToken: process.env.STORE_AUTH_TOKEN });
    await store.migrate();
    return store;
  })();
  return cached;
}
