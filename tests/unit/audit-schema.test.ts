import { describe, expect, it } from "vitest";

import { auditInput } from "@/lib/audit/schema";

const id = "3f2b7a1c-9d0e-4c5a-8b6d-1e2f3a4b5c6d";

describe("audit input contract", () => {
  it("accepts an agent action with GPS and device", () => {
    const rec = auditInput.parse({
      actor: { type: "agent", id, role: "agent", label: "AG-KAM-007" },
      action: "taxpayer.registered",
      object: { type: "taxpayer", id: "LUB-KAM-00000125" },
      where: { gps: { lng: 27.493, lat: -11.6642 } },
      device: { id },
    });
    expect(rec.details).toEqual({});
  });

  it("accepts a system action with defaults", () => {
    const rec = auditInput.parse({
      actor: { type: "system" },
      action: "payment.confirmed",
      object: { type: "payment", id: "TX-2609-13-0842-7K4M" },
    });
    expect(rec.actor).toEqual({ type: "system", label: "système" });
  });

  it("requires a role for admins and rejects GPS together with IP", () => {
    expect(() =>
      auditInput.parse({
        actor: { type: "admin", id, label: "Ngoy K." },
        action: "device.revoked",
        object: { type: "device", id },
      }),
    ).toThrow();
    expect(() =>
      auditInput.parse({
        actor: { type: "system" },
        action: "x.y",
        object: { type: "x", id: "1" },
        where: { gps: { lng: 0, lat: 0 }, ip: "1.2.3.4" },
      }),
    ).toThrow();
  });

  it("rejects actions that are not object.verb", () => {
    expect(() =>
      auditInput.parse({
        actor: { type: "system" },
        action: "Registered taxpayer",
        object: { type: "taxpayer", id: "1" },
      }),
    ).toThrow();
  });
});
