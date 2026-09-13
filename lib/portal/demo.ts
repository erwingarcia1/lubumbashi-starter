import { createHash } from "node:crypto";

/**
 * Demo-only portal tokens: derived from the taxpayer number and AGENT_SESSION_SECRET so the seed
 * prints the same link every run and the home page can show it. Never used in production: the
 * seed refuses to run there and the home page hides the link.
 */
export function demoPortalToken(
  taxpayerNo: string,
  secret = process.env.AGENT_SESSION_SECRET ?? "",
): string {
  return createHash("sha256")
    .update(`portal-demo:${taxpayerNo}:${secret}`)
    .digest("base64url")
    .slice(0, 32);
}

export function isDemoEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.APP_ENV !== "production" && env.NODE_ENV !== "production";
}
