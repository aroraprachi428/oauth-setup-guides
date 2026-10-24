import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { visitorHash } from "./limits";

const COOKIE = "vid";
const YEAR = 365 * 24 * 3600;

function secret(): string {
  const s = process.env.VISITOR_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") console.warn("VISITOR_SECRET is not set; visitor hashes use a fixed fallback.");
  return "dev-only-visitor-secret";
}

/** A salted visitor id for rate limits. Raw IPs and cookie values are never stored. */
export function identifyVisitor(req: NextRequest): { visitor: string; newCookie: string | null } {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const existing = req.cookies.get(COOKIE)?.value;
  const cookie = existing && /^[0-9a-f-]{36}$/.test(existing) ? existing : randomUUID();
  return { visitor: visitorHash(ip, cookie, secret()), newCookie: existing === cookie ? null : cookie };
}

export function setVisitorCookie(res: NextResponse, value: string | null) {
  if (value) res.cookies.set(COOKIE, value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: YEAR, path: "/" });
}
