import { z } from "zod";

const uuid = z.uuid();

const actor = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("admin"),
    id: uuid,
    role: z.string().min(1),
    label: z.string().min(1),
  }),
  z.object({
    type: z.literal("agent"),
    id: uuid,
    role: z.literal("agent"),
    label: z.string().min(1),
  }),
  z.object({ type: z.literal("taxpayer"), id: uuid, label: z.string().min(1).optional() }),
  z.object({ type: z.literal("system"), label: z.string().min(1).default("système") }),
]);

// Strict objects: a value carrying both gps and ip (or both id and userAgent) is rejected.
const where = z
  .union([
    z.strictObject({
      gps: z.strictObject({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }),
    }),
    z.strictObject({ ip: z.string().min(1) }),
  ])
  .optional();

const device = z
  .union([z.strictObject({ id: uuid }), z.strictObject({ userAgent: z.string().min(1) })])
  .optional();

/** Input contract of lib/audit/write(): WHO, WHAT, WHERE, DEVICE. WHEN is the server clock. */
export const auditInput = z.object({
  actor,
  action: z.string().regex(/^[a-z_]+\.[a-z_]+$/, "action must look like object.verb"),
  object: z.object({ type: z.string().min(1), id: z.string().min(1) }),
  details: z.record(z.string(), z.unknown()).default({}),
  where,
  device,
});

export type AuditInput = z.input<typeof auditInput>;
export type AuditRecord = z.output<typeof auditInput>;
