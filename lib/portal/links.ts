import { and, eq, gt, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";

import type { Db, Tx } from "@/lib/db/client";
import { portalLinks, taxpayers } from "@/lib/db/schema";

export const PORTAL_LINK_DAYS = 30;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function portalUrlFor(
  token: string,
  appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "",
): string {
  return `${appUrl.replace(/\/$/, "")}/t/${token}`;
}

/**
 * A signed, expiring link is the taxpayer's whole login (CLAUDE.md: no passwords). Only the
 * token's hash is stored; the token itself travels once, in the SMS.
 */
export async function issuePortalLink(
  db: Db | Tx,
  taxpayerId: string,
  now = new Date(),
  days = PORTAL_LINK_DAYS,
  purpose: "portal" | "sms_request" | "seed" = "portal",
  token = randomBytes(24).toString("base64url"),
): Promise<{ token: string; url: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + days * 86_400_000);
  await db
    .insert(portalLinks)
    .values({ taxpayerId, tokenHash: sha256(token), purpose, expiresAt, createdAt: now })
    .onConflictDoNothing({ target: portalLinks.tokenHash });
  return { token, url: portalUrlFor(token), expiresAt };
}

/** The taxpayer behind a token, or null (unknown, expired, revoked). Touches last_used_at. */
export async function resolvePortalLink(db: Db, token: string, now = new Date()) {
  if (!token || token.length > 64) return null;
  const [row] = await db
    .select({ link: portalLinks, taxpayer: taxpayers })
    .from(portalLinks)
    .innerJoin(taxpayers, eq(taxpayers.id, portalLinks.taxpayerId))
    .where(
      and(
        eq(portalLinks.tokenHash, sha256(token)),
        gt(portalLinks.expiresAt, now),
        isNull(portalLinks.revokedAt),
      ),
    );
  if (!row || row.taxpayer.status !== "active") return null;
  await db.update(portalLinks).set({ lastUsedAt: now }).where(eq(portalLinks.id, row.link.id));
  return row.taxpayer;
}

export async function revokePortalLinks(
  db: Db | Tx,
  taxpayerId: string,
  now = new Date(),
): Promise<void> {
  await db
    .update(portalLinks)
    .set({ revokedAt: now })
    .where(and(eq(portalLinks.taxpayerId, taxpayerId), isNull(portalLinks.revokedAt)));
}
