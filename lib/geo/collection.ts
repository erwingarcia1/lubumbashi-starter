import { writeAudit } from "@/lib/audit/write";
import type { Db } from "@/lib/db/client";

import { checkInside, fenceFor, type Fence, type LngLat } from "./fence";
import { positionRequiredForCollection } from "./policy";

export interface CollectingAgent {
  agentId: string;
  matricule: string;
  deviceId: string;
}

export type CollectionPositionVerdict =
  | { ok: true; fence: Fence | null; distanceM: number | null; positionMissing: boolean }
  | { ok: false; code: "outside_zone"; distanceM: number; allowedM: number; zone: string }
  | { ok: false; code: "position_required" };

/**
 * Geofence on collection (D37): before a payment request leaves the platform, the agent's
 * position must be inside the circle of the assigned zone. A refusal is audited as
 * `payment.refused` on the taxpayer (WHERE = the device GPS, DEVICE = the registered device);
 * an accepted request is audited by initiatePayment itself, so nothing is written here.
 */
export async function guardCollectionPosition(
  db: Db,
  agent: CollectingAgent,
  taxpayerNo: string,
  gps: (LngLat & { accuracyM?: number }) | undefined,
  env: Record<string, string | undefined> = process.env,
): Promise<CollectionPositionVerdict> {
  if (!gps) {
    if (!positionRequiredForCollection(env)) {
      return { ok: true, fence: null, distanceM: null, positionMissing: true };
    }
    await writeAudit(db, {
      actor: { type: "agent", id: agent.agentId, role: "agent", label: agent.matricule },
      action: "payment.refused",
      object: { type: "taxpayer", id: taxpayerNo },
      details: { reason: "position_required" },
      device: { id: agent.deviceId },
    });
    return { ok: false, code: "position_required" };
  }
  const fence = await fenceFor(db, agent.agentId);
  if (!fence) return { ok: true, fence: null, distanceM: null, positionMissing: false };
  const verdict = checkInside(fence, gps, gps.accuracyM);
  if (verdict.inside) {
    return { ok: true, fence, distanceM: verdict.distanceM, positionMissing: false };
  }
  await writeAudit(db, {
    actor: { type: "agent", id: agent.agentId, role: "agent", label: agent.matricule },
    action: "payment.refused",
    object: { type: "taxpayer", id: taxpayerNo },
    details: {
      reason: "outside_zone",
      distanceM: verdict.distanceM,
      allowedM: verdict.allowedM,
      zone: fence.zoneName,
      zoneCode: fence.zoneCode,
      accuracyM: gps.accuracyM ?? null,
    },
    where: { gps: { lng: gps.lng, lat: gps.lat } },
    device: { id: agent.deviceId },
  });
  return {
    ok: false,
    code: "outside_zone",
    distanceM: verdict.distanceM,
    allowedM: verdict.allowedM,
    zone: fence.zoneName,
  };
}
