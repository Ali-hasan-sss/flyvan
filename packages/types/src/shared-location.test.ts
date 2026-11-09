import { describe, expect, it } from "vitest";
import { isShortMapsLink, parseSharedLocation } from "./shared-location";

describe("shared location text", () => {
  it("reads a WhatsApp or Google maps link", () => {
    expect(parseSharedLocation("https://maps.google.com/?q=33.513800,36.276500")).toEqual({
      latitude: 33.5138,
      longitude: 36.2765,
    });
    expect(parseSharedLocation("https://www.google.com/maps/@33.520100,36.280200,17z")).toEqual({
      latitude: 33.5201,
      longitude: 36.2802,
    });
    expect(parseSharedLocation("https://www.google.com/maps/place/Uni/!3d33.513800!4d36.276500")).toEqual({
      latitude: 33.5138,
      longitude: 36.2765,
    });
  });

  it("reads plain coordinates and degrees", () => {
    expect(parseSharedLocation("33.5138، 36.2765")).toEqual({ latitude: 33.5138, longitude: 36.2765 });
    expect(parseSharedLocation(`33°30'49.7"N 36°16'35.4"E`)?.latitude).toBeCloseTo(33.513806, 3);
  });

  it("recognizes short map links that need a redirect", () => {
    expect(isShortMapsLink("الموقع https://maps.app.goo.gl/abc123")).toBe(true);
    expect(isShortMapsLink("https://maps.google.com/?q=33.5,36.2")).toBe(false);
  });
});
