import { describe, expect, it } from "vitest";
import { decideOffer, straightLineMeters } from "./matching";

const ready = {
  driverApproved: true,
  vehicleApproved: true,
  assignmentBlocked: false,
  acceptsNearby: true,
  nearbyRadiusMeters: 3000,
};

describe("trip offer matching", () => {
  it("offers a service-area request even when the driver is far away", () => {
    const decision = decideOffer({
      ...ready,
      straightLineMeters: 48_000,
      area: { status: "APPROVED", preference: "TARGET", areaActive: true },
    });

    expect(decision).toEqual({
      allowed: true,
      source: "SERVICE_AREA",
      reason: "الطلب داخل منطقة خدمة وافق السائق على العمل فيها.",
    });
  });

  it("offers a nearby request when the other operating conditions pass", () => {
    const decision = decideOffer({
      ...ready,
      straightLineMeters: 1200,
      area: null,
    });

    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.source).toBe("NEARBY");
    }
  });

  it("does not treat proximity as the only way to receive a request", () => {
    const farWithoutArea = decideOffer({
      ...ready,
      straightLineMeters: 20_000,
      area: null,
    });
    const farInsideArea = decideOffer({
      ...ready,
      straightLineMeters: 20_000,
      area: { status: "APPROVED", preference: "TARGET", areaActive: true },
    });

    expect(farWithoutArea.allowed).toBe(false);
    expect(farInsideArea.allowed).toBe(true);
  });

  it("ignores a pending area and blocks an excluded area", () => {
    expect(
      decideOffer({
        ...ready,
        straightLineMeters: 20_000,
        area: { status: "PENDING", preference: "TARGET", areaActive: true },
      }).allowed,
    ).toBe(false);
    expect(
      decideOffer({
        ...ready,
        straightLineMeters: 500,
        area: { status: "APPROVED", preference: "EXCLUDED", areaActive: true },
      }).allowed,
    ).toBe(false);
  });

  it("refuses an unapproved driver or vehicle", () => {
    expect(decideOffer({ ...ready, driverApproved: false, straightLineMeters: 100, area: null }).allowed).toBe(
      false,
    );
    expect(decideOffer({ ...ready, vehicleApproved: false, straightLineMeters: 100, area: null }).allowed).toBe(
      false,
    );
  });

  it("measures a short straight line without calling it a road duration", () => {
    const meters = straightLineMeters(
      { latitude: 33.5138, longitude: 36.2765 },
      { latitude: 33.522, longitude: 36.2765 },
    );
    expect(meters).toBeGreaterThan(800);
    expect(meters).toBeLessThan(1100);
  });
});
