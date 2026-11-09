import { describe, expect, it } from "vitest";
import {
  arrivalState,
  canCancelBrokenTrip,
  canTransitionTrip,
  driverMayStartTrip,
  insideDestinationFinishCircle,
  formatBookingReference,
  formatDailyReference,
  formatStoredFare,
  normalizeCoordinate,
  normalizeCurrency,
  normalizeFare,
  alignRouteLegs,
  nearestPassengerOrder,
  planPickupTimes,
  planVehicleNeed,
  rankByStraightLine,
  revealPassengerDetails,
  routeStopOrder,
  selectDriverTrip,
} from "./operations.rules";

describe("trip transitions", () => {
  it("allows the operational path and blocks skips", () => {
    expect(canTransitionTrip("PENDING_ASSIGNMENT", "ASSIGNED")).toBe(true);
    expect(canTransitionTrip("ASSIGNED", "DRIVER_ARRIVED")).toBe(true);
    expect(canTransitionTrip("ASSIGNED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionTrip("DRIVER_ARRIVED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionTrip("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canTransitionTrip("PENDING_ASSIGNMENT", "COMPLETED")).toBe(false);
    expect(canTransitionTrip("COMPLETED", "CANCELLED")).toBe(false);
    expect(canTransitionTrip("CANCELLED", "ASSIGNED")).toBe(false);
    expect(canTransitionTrip("IN_PROGRESS", "CANCELLED")).toBe(false);
  });

  it("lets dispatch cancel a running trip only after a breakdown report", () => {
    expect(canCancelBrokenTrip({ actorCanDispatch: true, status: "IN_PROGRESS", breakdownReported: true })).toBe(true);
    expect(canCancelBrokenTrip({ actorCanDispatch: true, status: "IN_PROGRESS", breakdownReported: false })).toBe(false);
    expect(canCancelBrokenTrip({ actorCanDispatch: false, status: "IN_PROGRESS", breakdownReported: true })).toBe(false);
    expect(canCancelBrokenTrip({ actorCanDispatch: true, status: "ASSIGNED", breakdownReported: true })).toBe(false);
    expect(canCancelBrokenTrip({ actorCanDispatch: true, status: "IN_PROGRESS", breakdownReported: false, arrivalStalled: true })).toBe(true);
  });
});

describe("arrival allowance", () => {
  const arrivesAt = new Date("2026-11-01T14:00:00.000Z");
  const open = { arrivesAt, isDaily: false, parentTripId: null, status: "IN_PROGRESS" };

  it("stays on time for a quarter hour, then late, then stalled after one hour", () => {
    expect(arrivalState(open, new Date("2026-11-01T14:15:00.000Z"))).toBe("ON_TIME");
    expect(arrivalState(open, new Date("2026-11-01T14:15:01.000Z"))).toBe("LATE");
    expect(arrivalState(open, new Date("2026-11-01T14:59:59.000Z"))).toBe("LATE");
    expect(arrivalState(open, new Date("2026-11-01T15:00:00.000Z"))).toBe("STALLED");
    expect(arrivalState({ ...open, status: "COMPLETED" }, new Date("2026-11-01T16:00:00.000Z"))).toBe("ON_TIME");
  });

  it("repeats a daily route on the same civil clock instead of the first service date", () => {
    const daily = { arrivesAt: new Date("2026-10-28T14:00:00.000Z"), isDaily: true, parentTripId: null, status: "ASSIGNED" };
    expect(arrivalState(daily, new Date("2026-11-01T14:10:00.000Z"))).toBe("ON_TIME");
    expect(arrivalState(daily, new Date("2026-11-01T15:00:00.000Z"))).toBe("STALLED");
    expect(arrivalState({ ...daily, parentTripId: "run" }, new Date("2026-11-01T14:10:00.000Z"))).toBe("STALLED");
  });

  it("lets a driver start up to one hour before departure and not earlier", () => {
    const scheduledAt = new Date("2026-11-01T10:00:00.000Z");
    const trip = { scheduledAt, isDaily: false, parentTripId: null };
    expect(driverMayStartTrip(trip, new Date("2026-11-01T09:00:00.000Z"))).toBe(true);
    expect(driverMayStartTrip(trip, new Date("2026-11-01T08:59:59.000Z"))).toBe(false);
    expect(driverMayStartTrip(trip, new Date("2026-11-01T10:30:00.000Z"))).toBe(true);
  });

  it("keeps the finish control inside a one-kilometer diameter", () => {
    expect(insideDestinationFinishCircle(0)).toBe(true);
    expect(insideDestinationFinishCircle(500)).toBe(true);
    expect(insideDestinationFinishCircle(501)).toBe(false);
  });
});

describe("booking money and reference", () => {
  it("keeps fare as a two-decimal string and rejects empty or invalid amounts", () => {
    expect(normalizeFare("10.5")).toBe("10.50");
    expect(normalizeFare("0")).toBe("");
    expect(normalizeFare("10.555")).toBe("");
    expect(formatStoredFare({ toString: () => "25.5" })).toBe("25.50");
  });

  it("accepts only a three-letter currency code", () => {
    expect(normalizeCurrency("syp")).toBe("SYP");
    expect(normalizeCurrency("US")).toBe("");
  });

  it("builds a unique daily reference without sharing it between directions", () => {
    expect(formatBookingReference("20261021", 1)).toBe("FV-20261021-0001");
    expect(formatBookingReference("20261021", 2)).not.toBe(formatBookingReference("20261021", 1));
    expect(formatDailyReference("TR", "20261021", 3)).toBe("TR-20261021-0003");
  });

  it("keeps map coordinates as decimal strings inside the valid range", () => {
    expect(normalizeCoordinate("33.5138", "lat")).toBe("33.5138");
    expect(normalizeCoordinate("-36.276528", "lng")).toBe("-36.276528");
    expect(normalizeCoordinate("95", "lat")).toBe("");
    expect(normalizeCoordinate("33.1234567", "lat")).toBe("");
  });
});

describe("pickup timing", () => {
  it("picks up the farther passenger first and keeps every stop before arrival", () => {
    const departsAt = new Date("2026-10-22T04:30:00.000Z");
    const arrivesAt = new Date("2026-10-22T05:00:00.000Z");
    const plan = planPickupTimes({
      departsAt,
      arrivesAt,
      destinationLatitude: 33.5138,
      destinationLongitude: 36.2765,
      passengers: [
        { id: "near", latitude: 33.52, longitude: 36.28 },
        { id: "far", latitude: 33.7, longitude: 36.5 },
      ],
    });
    expect(plan.map((item) => item.id)).toEqual(["far", "near"]);
    expect(plan[0]?.pickupAt.toISOString()).toBe(departsAt.toISOString());
    expect(plan[1]?.pickupAt.getTime()).toBeGreaterThan(departsAt.getTime());
    expect(plan[1]?.pickupAt.getTime()).toBeLessThan(arrivesAt.getTime());
    const ordered = routeStopOrder([
      { id: "later", pickupAt: plan[1]?.pickupAt ?? null },
      { id: "sooner", pickupAt: plan[0]?.pickupAt ?? null },
      { id: "unset", pickupAt: null },
    ]);
    expect(ordered.map((item) => item.id)).toEqual(["sooner", "later", "unset"]);
  });
});

describe("driver trip selection", () => {
  const at = (hour: number, status: string) => ({ id: status + hour, status, scheduledAt: new Date(`2026-10-24T0${hour}:00:00.000Z`) });

  it("shows the underway trip before a later assigned trip", () => {
    const selected = selectDriverTrip([
      at(4, "ASSIGNED"),
      at(2, "IN_PROGRESS"),
      at(1, "DRIVER_ARRIVED"),
    ]);
    expect(selected).toEqual({ trip: at(1, "DRIVER_ARRIVED"), phase: "current" });
  });

  it("shows the earliest assigned trip when nothing is underway", () => {
    const selected = selectDriverTrip([at(5, "ASSIGNED"), at(3, "ASSIGNED"), at(4, "COMPLETED")]);
    expect(selected?.phase).toBe("next");
    expect(selected?.trip.id).toBe("ASSIGNED3");
  });

  it("returns nothing when the driver has no active assignment", () => {
    expect(selectDriverTrip([at(4, "OFFERED"), at(5, "COMPLETED")])).toBeNull();
  });
});

describe("nearest road pickup order", () => {
  it("visits the closer passenger first, then the remaining one", () => {
    const distances = [
      [0, 5000, 1000],
      [5000, 0, 2000],
      [1000, 2000, 0],
    ];
    expect(nearestPassengerOrder(distances, 2)).toEqual([1, 0]);
  });

  it("stops when a passenger cannot be reached by road", () => {
    expect(nearestPassengerOrder([[0, Number.NaN], [Number.NaN, 0]], 1)).toEqual([]);
    expect(nearestPassengerOrder([[0, 10]], 1)).toEqual([]);
  });
});

describe("route legs", () => {
  it("keeps each road leg when the provider already split the path", () => {
    const legs = alignRouteLegs(
      {
        coordinates: [
          { latitude: 33.5, longitude: 36.2 },
          { latitude: 33.52, longitude: 36.22 },
          { latitude: 33.55, longitude: 36.25 },
        ],
        legs: [
          { distanceMeters: 800.2, durationSeconds: 90.4, coordinates: [{ latitude: 33.5, longitude: 36.2 }, { latitude: 33.52, longitude: 36.22 }] },
          { distanceMeters: 1400.6, durationSeconds: 160.2, coordinates: [{ latitude: 33.52, longitude: 36.22 }, { latitude: 33.55, longitude: 36.25 }] },
        ],
      },
      [
        { kind: "driver", label: "موقعك", latitude: "33.5", longitude: "36.2" },
        { kind: "pickup", label: "أحمد", latitude: "33.52", longitude: "36.22" },
        { kind: "destination", label: "الجامعة", latitude: "33.55", longitude: "36.25" },
      ],
    );
    expect(legs.map((leg) => leg.label)).toEqual(["أحمد", "الجامعة"]);
    expect(legs[0]?.targetKind).toBe("pickup");
    expect(legs[1]?.targetKind).toBe("destination");
    expect(legs[0]?.distanceMeters).toBe(800);
  });

  it("splits one road line at the passenger before the destination", () => {
    const legs = alignRouteLegs(
      {
        coordinates: [
          { latitude: 33.5, longitude: 36.2 },
          { latitude: 33.51, longitude: 36.21 },
          { latitude: 33.52, longitude: 36.22 },
          { latitude: 33.54, longitude: 36.24 },
          { latitude: 33.55, longitude: 36.25 },
        ],
        legs: [],
      },
      [
        { kind: "driver", label: "موقعك", latitude: "33.5", longitude: "36.2" },
        { kind: "pickup", label: "أحمد", latitude: "33.52", longitude: "36.22" },
        { kind: "destination", label: "الجامعة", latitude: "33.55", longitude: "36.25" },
      ],
    );
    expect(legs).toHaveLength(2);
    expect(legs[0]?.coordinates.at(-1)).toEqual({ latitude: 33.52, longitude: 36.22 });
    expect(legs[1]?.coordinates[0]).toEqual({ latitude: 33.52, longitude: 36.22 });
    expect(legs[1]?.targetKind).toBe("destination");
  });
});

describe("passenger visibility", () => {
  it("hides precise passenger details until the trip is assigned to that driver", () => {
    expect(revealPassengerDetails({ seeAll: false, assignedToViewer: false })).toBe(false);
    expect(revealPassengerDetails({ seeAll: false, assignedToViewer: true })).toBe(true);
    expect(revealPassengerDetails({ seeAll: true, assignedToViewer: false })).toBe(true);
  });
});

describe("vehicles needed for the next run", () => {
  it("uses the largest linked vehicles first and leaves the rest unselected", () => {
    expect(planVehicleNeed(0, [14, 7])).toEqual({ needed: 0, seats: 21, shortfall: 0 });
    expect(planVehicleNeed(10, [14, 14, 7])).toEqual({ needed: 1, seats: 35, shortfall: 0 });
    expect(planVehicleNeed(20, [14, 14, 7])).toEqual({ needed: 2, seats: 35, shortfall: 0 });
    expect(planVehicleNeed(8, [4])).toEqual({ needed: 1, seats: 4, shortfall: 4 });
  });

  it("ranks passengers by straight-line distance from the driver and skips those without a pin", () => {
    const ranked = rankByStraightLine(33.5, 36.2, [
      { id: "far", latitude: 33.7, longitude: 36.4 },
      { id: "missing", latitude: null, longitude: null },
      { id: "near", latitude: 33.51, longitude: 36.21 },
    ]);
    expect(ranked.map((item) => item.passenger.id)).toEqual(["near", "far", "missing"]);
    expect(ranked[0]?.distanceMeters).toBeLessThan(ranked[1]?.distanceMeters ?? 0);
    expect(ranked[2]?.distanceMeters).toBeNull();
  });
});
