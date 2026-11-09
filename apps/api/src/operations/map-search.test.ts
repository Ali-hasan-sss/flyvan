import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { readPlaceMatches, searchPlaces } from "./map-search";

describe("place search", () => {
  it("keeps named Syrian matches and drops incomplete rows", () => {
    expect(
      readPlaceMatches([
        { lat: "34.889012", lon: "35.886612", display_name: "طرطوس، سوريا" },
        { lat: "nope", lon: "35.8", display_name: "بدون إحداثيات" },
        { lat: "34.8", lon: "35.9" },
      ]),
    ).toEqual([{ label: "طرطوس، سوريا", latitude: "34.889012", longitude: "35.886612" }]);
  });

  it("asks Nominatim for an Arabic place name inside Syria", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: "34.895", lon: "35.886", display_name: "الشيخ سعد، طرطوس" }],
    });
    await expect(searchPlaces("الشيخ سعد", fetchMock)).resolves.toEqual([
      { label: "الشيخ سعد، طرطوس", latitude: "34.895", longitude: "35.886" },
    ]);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("countrycodes=sy");
    expect(decodeURIComponent(url.replace(/\+/g, " "))).toContain("الشيخ سعد");
  });

  it("rejects an empty or link-shaped query", async () => {
    await expect(searchPlaces(" ")).rejects.toBeInstanceOf(BadRequestException);
    await expect(searchPlaces("https://maps.example/x")).rejects.toBeInstanceOf(BadRequestException);
  });
});
