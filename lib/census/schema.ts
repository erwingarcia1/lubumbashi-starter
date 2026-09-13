import { z } from "zod";

const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/);

/** The census record sent by the agent app (online now, from the offline outbox in M8). */
export const censusInput = z.object({
  /** Client-generated UUID: the same record sent twice yields the same taxpayer. */
  clientUuid: z.uuid(),
  taxpayer: z.object({
    kind: z.enum(["person", "company"]),
    fullName: z.string().trim().min(3).max(120),
    contactName: z.string().trim().max(120).optional(),
    phone: e164,
    idType: z.string().trim().max(40).optional(),
    idNumber: z.string().trim().max(60).optional(),
    communeCode: z.string().regex(/^[A-Z]{3}$/),
    quartierCode: z.string().trim().min(1).max(40),
    address: z.string().trim().min(3).max(200),
  }),
  entity: z.object({
    kind: z.enum(["property", "business", "activity"]),
    categoryCode: z.string().trim().min(1),
    name: z.string().trim().min(3).max(120),
    gps: z.object({
      lng: z.number().min(-180).max(180),
      lat: z.number().min(-90).max(90),
      accuracyM: z.number().int().nonnegative().optional(),
    }),
    taxBaseFc: z.number().int().nonnegative().optional(),
  }),
  /** When the agent captured the record (offline); the server clock is the audit time. */
  capturedAt: z.iso.datetime({ offset: true }).optional(),
});
export type CensusInput = z.infer<typeof censusInput>;

export const duplicateQuery = z.object({
  phone: e164.optional(),
  fullName: z.string().trim().min(3).optional(),
  gps: z.object({ lng: z.number(), lat: z.number() }).optional(),
});
export type DuplicateQuery = z.infer<typeof duplicateQuery>;
