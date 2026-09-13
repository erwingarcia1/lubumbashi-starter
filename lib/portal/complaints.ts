import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "@/lib/audit/write";
import type { Db } from "@/lib/db/client";
import { complaintCategories, complaints } from "@/lib/db/schema";

export const complaintInput = z.strictObject({
  categoryCode: z.string().min(1).max(64),
  description: z.string().trim().min(5).max(2000),
  /** E.164 Congolese number, e.g. +243994128830. */
  phone: z.string().regex(/^\+243\d{9}$/),
});
export type ComplaintInput = z.infer<typeof complaintInput>;

export class ComplaintError extends Error {
  constructor(readonly code: "unknown_category") {
    super(code);
    this.name = "ComplaintError";
  }
}

export async function listComplaintCategories(db: Db) {
  return db
    .select({ code: complaintCategories.code, labelFr: complaintCategories.labelFr })
    .from(complaintCategories)
    .orderBy(asc(complaintCategories.sortOrder));
}

/** Files a complaint from the portal (screen p-complaint); audited with the taxpayer as actor. */
export async function fileComplaint(
  db: Db,
  taxpayer: { id: string; taxpayerNo: string },
  raw: ComplaintInput,
  ctx: { ip?: string; userAgent?: string } = {},
  now = new Date(),
) {
  const input = complaintInput.parse(raw);
  const [category] = await db
    .select({ id: complaintCategories.id, labelFr: complaintCategories.labelFr })
    .from(complaintCategories)
    .where(eq(complaintCategories.code, input.categoryCode));
  if (!category) throw new ComplaintError("unknown_category");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(complaints)
      .values({
        taxpayerId: taxpayer.id,
        categoryId: category.id,
        description: input.description,
        contactPhone: input.phone,
        createdAt: now,
      })
      .returning({ id: complaints.id, status: complaints.status, createdAt: complaints.createdAt });
    await writeAudit(tx, {
      actor: { type: "taxpayer", id: taxpayer.id, label: taxpayer.taxpayerNo },
      action: "complaint.filed",
      object: { type: "complaint", id: row!.id },
      details: { category: input.categoryCode },
      where: ctx.ip ? { ip: ctx.ip } : undefined,
      device: ctx.userAgent ? { userAgent: ctx.userAgent } : undefined,
    });
    return { ...row!, categoryLabelFr: category.labelFr };
  });
}
