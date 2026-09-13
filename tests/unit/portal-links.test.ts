import { describe, expect, it } from "vitest";

import { invoiceUrlFor } from "@/lib/portal/invoice";
import { portalUrlFor } from "@/lib/portal/links";
import { portalCookieOptions } from "@/lib/portal/session";

describe("portal URLs and cookie", () => {
  it("builds /t/<token> and /f/<no>/<token> without a double slash", () => {
    expect(portalUrlFor("abc", "https://recouvrement.cd/")).toBe("https://recouvrement.cd/t/abc");
    expect(invoiceUrlFor("AV-2609-000482", "tok", "https://recouvrement.cd")).toBe(
      "https://recouvrement.cd/f/AV-2609-000482/tok",
    );
  });

  it("cookie is httpOnly, lax, and secure only behind HTTPS", () => {
    expect(portalCookieOptions("http://localhost:3000")).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    });
    expect(portalCookieOptions("https://x.cd").secure).toBe(true);
    expect(portalCookieOptions("https://x.cd").maxAge).toBe(12 * 3600);
  });
});
