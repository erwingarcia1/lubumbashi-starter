import Dexie, { type EntityTable } from "dexie";

/**
 * The agent phone's local store (IndexedDB). The outbox holds census records and contact updates
 * only: payments are online-only (CLAUDE.md invariant 3) and have no place here, by type.
 */
export const OUTBOX_KINDS = ["census", "contact_update"] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];
export type OutboxStatus = "queued" | "done" | "failed";
export type PhotoKind = "person" | "id_card" | "facade";

export interface OutboxItem {
  id?: number;
  kind: OutboxKind;
  /** Client UUID: the server is idempotent on it, so a retry never creates a second record. */
  clientUuid: string;
  payload: unknown;
  /** What the queue screen shows (name · address). */
  label: string;
  createdAt: string;
  attempts: number;
  lastError: string | null;
  status: OutboxStatus;
  /** Server-side reference once done (taxpayer number). */
  serverRef: string | null;
  /** Photos captured with a census record; uploaded after the record, never blocking it. */
  photos: Array<{ kind: PhotoKind; blob: Blob }>;
  /** Entity id returned by the server, needed to upload the photos. */
  entityId: string | null;
}

export interface CacheEntry {
  key: string;
  value: unknown;
  syncedAt: string;
}

/**
 * A position ping waiting for the network (D38). Not an outbox item: pings are not records. It
 * carries the matricule of the agent logged in when it was taken: on a shared phone the next
 * agent's session must never send (and so be credited with) a colleague's positions.
 */
export interface Ping {
  id?: number;
  matricule: string;
  /** Device clock at the fix (ISO 8601). */
  recordedAt: string;
  lng: number;
  lat: number;
  accuracyM: number | null;
}

export class AgentDb extends Dexie {
  outbox!: EntityTable<OutboxItem, "id">;
  cache!: EntityTable<CacheEntry, "key">;
  pings!: EntityTable<Ping, "id">;

  constructor(name = "lubumbashi-agent") {
    super(name);
    this.version(1).stores({
      outbox: "++id, clientUuid, status, createdAt",
      cache: "key",
    });
    // Version 2 adds the position queue (indexed by agent for shared phones); the outbox keeps
    // its kinds (invariant 3).
    this.version(2).stores({
      outbox: "++id, clientUuid, status, createdAt",
      cache: "key",
      pings: "++id, recordedAt, matricule",
    });
  }
}

let instance: AgentDb | undefined;

/** One database per browser profile; created on first use (never at import time: SSR bundles). */
export function getAgentDb(): AgentDb {
  instance ??= new AgentDb();
  return instance;
}
