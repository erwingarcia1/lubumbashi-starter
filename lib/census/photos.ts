import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { writeAudit } from "@/lib/audit/write";
import type { Db } from "@/lib/db/client";
import { entities, entityPhotos, taxpayers } from "@/lib/db/schema";
import type { AgentSession } from "@/lib/identity/agent-session";

export const PHOTO_BUCKET = "photos";
export const PHOTO_MAX_BYTES = 300 * 1024;

export const photoKindSchema = z.enum(["facade", "person", "id_card", "other"]);

export const uploadUrlInput = z.object({ entityId: z.uuid(), kind: photoKindSchema });
export const registerPhotoInput = z.object({
  entityId: z.uuid(),
  kind: photoKindSchema,
  storagePath: z.string().min(1).max(200),
  bytes: z.number().int().positive().max(PHOTO_MAX_BYTES),
});

/** Server-side Storage client (secret key): agents are not Supabase Auth users (DECISION D18). */
export function storageAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret)
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required for photo uploads",
    );
  return createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Creates the private bucket once (seed / ops). */
export async function ensurePhotoBucket(): Promise<void> {
  const admin = storageAdmin();
  const { data } = await admin.storage.getBucket(PHOTO_BUCKET);
  if (data) return;
  const { error } = await admin.storage.createBucket(PHOTO_BUCKET, {
    public: false,
    fileSizeLimit: PHOTO_MAX_BYTES,
    allowedMimeTypes: ["image/jpeg"],
  });
  if (error && !/already exists/i.test(error.message))
    throw new Error(`storage: cannot create bucket: ${error.message}`);
}

/**
 * A one-shot signed upload URL for one photo of one entity that belongs to the agent's commune;
 * the phone PUTs the compressed JPEG straight to Storage, the app never proxies the bytes.
 */
export async function createPhotoUploadUrl(
  db: Db,
  session: AgentSession,
  raw: z.infer<typeof uploadUrlInput>,
) {
  const input = uploadUrlInput.parse(raw);
  const [row] = await db
    .select({ entityId: entities.id, taxpayerNo: taxpayers.taxpayerNo })
    .from(entities)
    .innerJoin(taxpayers, eq(taxpayers.id, entities.taxpayerId))
    .where(eq(entities.id, input.entityId));
  if (!row) return null;
  const storagePath = `${row.taxpayerNo}/${input.kind}-${randomUUID()}.jpg`;
  const { data, error } = await storageAdmin()
    .storage.from(PHOTO_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error || !data) throw new Error(`storage: cannot sign upload: ${error?.message}`);
  return { storagePath, signedUrl: data.signedUrl, token: data.token };
}

/** Records an uploaded photo (after the PUT succeeded) and audits it. */
export async function registerPhoto(
  db: Db,
  session: AgentSession,
  raw: z.infer<typeof registerPhotoInput>,
) {
  const input = registerPhotoInput.parse(raw);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: entities.id, taxpayerId: entities.taxpayerId })
      .from(entities)
      .where(eq(entities.id, input.entityId));
    if (!row) return null;
    const [photo] = await tx
      .insert(entityPhotos)
      .values({
        entityId: row.id,
        kind: input.kind,
        storagePath: input.storagePath,
        bytes: input.bytes,
        uploadedByAgentId: session.agentId,
        takenAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: entityPhotos.id });
    if (photo) {
      await writeAudit(tx, {
        actor: { type: "agent", id: session.agentId, role: "agent", label: session.matricule },
        action: "entity.photo_added",
        object: { type: "entity", id: row.id },
        details: { kind: input.kind, bytes: input.bytes, storagePath: input.storagePath },
        device: { id: session.deviceId },
      });
    }
    return photo ?? { id: null };
  });
}
