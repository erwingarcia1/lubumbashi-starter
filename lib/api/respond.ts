import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

/** JSON helpers for /api/v1: every body is validated with Zod (the schemas are the contract). */
export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(code: string, status = 400, details?: unknown) {
  return NextResponse.json({ ok: false, error: { code, details } }, { status });
}

export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<{ data: T } | { error: NextResponse }> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return { error: fail("invalid_json", 400) };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { error: fail("invalid_input", 422, parsed.error.issues) };
  return { data: parsed.data };
}

export function isZodError(err: unknown): err is ZodError {
  return err instanceof ZodError;
}

export function requestContext(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || request.headers.get("x-real-ip") || undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
  };
}
