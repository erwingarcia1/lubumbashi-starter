import { randomInt } from "node:crypto";

import { businessClock, yymm } from "@/lib/time";

/** No 0/O/1/I: read aloud on the phone, typed on a keypad. */
export const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERENCE_RE = /^TX-\d{4}-\d{2}-\d{4}-[A-HJ-NP-Z2-9]{4}$/;

const pad = (n: number) => String(n).padStart(2, "0");

/** TX-YYMM-DD-HHMM-XXXX in Africa/Lubumbashi (invariant 5); the caller retries on collision. */
export function generateReference(now: Date, pick: (n: number) => number = randomInt): string {
  const c = businessClock(now);
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += REFERENCE_ALPHABET[pick(REFERENCE_ALPHABET.length)];
  return `TX-${yymm(now)}-${pad(c.day)}-${pad(c.hour)}${pad(c.minute)}-${suffix}`;
}

export function isReference(value: string): boolean {
  return REFERENCE_RE.test(value);
}
