import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getDb } from "@/lib/db/client";
import { agents, devices } from "@/lib/db/schema";

export const AGENT_COOKIE = "agent_session";
export const AGENT_SESSION_HOURS = 12;

export interface AgentTokenPayload {
  agentId: string;
  deviceId: string;
  /** Unix seconds. */
  exp: number;
}

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array | string): string {
  if (typeof bytes === "string") return Buffer.from(bytes, "utf8").toString("base64url");
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString("base64url");
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export function sessionSecret(): string {
  const secret = process.env.AGENT_SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("AGENT_SESSION_SECRET must be set (32+ characters)");
  return secret;
}

/** `payload.signature`, HMAC-SHA256 with AGENT_SESSION_SECRET (Web Crypto: works in proxy.ts too). */
export async function signAgentToken(
  payload: AgentTokenPayload,
  secret = sessionSecret(),
): Promise<string> {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyAgentToken(
  token: string | undefined,
  secret = sessionSecret(),
  now = Date.now(),
): Promise<AgentTokenPayload | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as AgentTokenPayload;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < now) return null;
    if (typeof payload.agentId !== "string" || typeof payload.deviceId !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

export interface AgentSession {
  agentId: string;
  matricule: string;
  fullName: string;
  zoneId: string;
  communeId: string;
  deviceId: string;
  deviceCode: string;
}

/**
 * The logged-in agent, or null. The device row is re-read on every request so a revocation
 * from the dashboard takes effect immediately (invariant: device auth is server-side).
 */
export async function getAgentSession(): Promise<AgentSession | null> {
  const store = await cookies();
  const payload = await verifyAgentToken(store.get(AGENT_COOKIE)?.value);
  if (!payload) return null;
  const [row] = await getDb()
    .select({ agent: agents, device: devices })
    .from(devices)
    .innerJoin(agents, eq(agents.id, devices.agentId))
    .where(and(eq(devices.id, payload.deviceId), eq(agents.id, payload.agentId)));
  if (!row || row.agent.status !== "active" || row.device.status !== "active") return null;
  return {
    agentId: row.agent.id,
    matricule: row.agent.matricule,
    fullName: row.agent.fullName,
    zoneId: row.agent.zoneId,
    communeId: row.agent.communeId,
    deviceId: row.device.id,
    deviceCode: row.device.deviceCode,
  };
}

export async function requireAgent(): Promise<AgentSession> {
  const session = await getAgentSession();
  if (!session) redirect("/agent/login");
  return session;
}
