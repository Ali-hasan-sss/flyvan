import { describe, expect, it, vi } from "vitest";
import { expandMapsLink } from "./location-link";

describe("expandMapsLink", () => {
  it("follows a short maps link to the final google url", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 302,
      headers: { get: () => "https://www.google.com/maps?q=33.5138,36.2765" },
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(expandMapsLink("https://maps.app.goo.gl/abc")).resolves.toEqual({
      url: "https://www.google.com/maps?q=33.5138,36.2765",
    });
    vi.unstubAllGlobals();
  });

  it("rejects a link that is not a map", async () => {
    await expect(expandMapsLink("https://example.com/place")).rejects.toThrow(/خرائط/);
  });
});
