"use client";

import { useCallback, useSyncExternalStore } from "react";

// Ticked step ids per guide, kept in this browser only. Memory is the source of
// truth for the visit, so ticks still work when storage is blocked.
const EVENT = "guide-checks";
const EMPTY: string[] = [];
const memory = new Map<string, string[]>();

function load(key: string): string[] {
  if (!memory.has(key)) {
    let ids: string[] = [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
      if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      // Storage blocked or corrupt: start empty.
    }
    memory.set(key, ids);
  }
  return memory.get(key)!;
}

function save(key: string, ids: string[]) {
  memory.set(key, ids);
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    // Storage blocked or full: ticks last until the page closes.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

export function useChecks(key: string) {
  const done = useSyncExternalStore(subscribe, () => load(key), () => EMPTY);
  const toggle = useCallback(
    (id: string) => {
      const current = load(key);
      save(key, current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
    },
    [key],
  );
  return { done, toggle };
}
