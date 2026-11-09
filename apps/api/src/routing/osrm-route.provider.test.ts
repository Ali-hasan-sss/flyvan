import { describe, expect, it } from "vitest";
import { OsrmRouteError, OsrmRouteProvider, parseOsrmRoute, parseOsrmTable } from "./osrm-route.provider";

describe("OSRM route parsing", () => {
  it("reads the road geometry and distance", () => {
    const path = parseOsrmRoute({
      code: "Ok",
      routes: [{ distance: 1500.4, duration: 180.2, geometry: { coordinates: [[36.28, 33.51], [36.29, 33.52]] } }],
    });
    expect(path.distanceMeters).toBe(1500.4);
    expect(path.coordinates[0]).toEqual({ latitude: 33.51, longitude: 36.28 });
    expect(path.legs).toHaveLength(1);
  });

  it("keeps a separate road geometry for each passenger leg", () => {
    const path = parseOsrmRoute({
      code: "Ok",
      routes: [{
        distance: 900,
        duration: 120,
        geometry: { coordinates: [[36.2, 33.5], [36.22, 33.52], [36.25, 33.55]] },
        legs: [
          {
            distance: 400,
            duration: 50,
            steps: [{ geometry: { coordinates: [[36.2, 33.5], [36.22, 33.52]] } }],
          },
          {
            distance: 500,
            duration: 70,
            steps: [{ geometry: { coordinates: [[36.22, 33.52], [36.25, 33.55]] } }],
          },
        ],
      }],
    });
    expect(path.legs.map((leg) => leg.coordinates.length)).toEqual([2, 2]);
    expect(path.legs[1]?.coordinates[1]).toEqual({ latitude: 33.55, longitude: 36.25 });
  });

  it("reads a driving distance table and keeps unreachable cells empty", () => {
    expect(parseOsrmTable({ code: "Ok", distances: [[0, 1200], [1300, 0]] }, 2)).toEqual([
      [0, 1200],
      [1300, 0],
    ]);
    expect(parseOsrmTable({ code: "Ok", distances: [[0, null], [null, 0]] }, 2)[0]?.[1]).toBeNaN();
  });

  it("rejects a missing road", () => {
    expect(() => parseOsrmRoute({ code: "NoRoute", routes: [] })).toThrow(OsrmRouteError);
  });

  it("asks the provider with longitude first and keeps the driving path", async () => {
    const provider = new OsrmRouteProvider("https://routes.example", (async (url) => {
      expect(String(url)).toContain("/route/v1/driving/36.2,33.5;36.3,33.6");
      expect(String(url)).toContain("continue_straight=false");
      return new Response(JSON.stringify({
        code: "Ok",
        routes: [{ distance: 2200, duration: 240, geometry: { coordinates: [[36.2, 33.5], [36.25, 33.55], [36.3, 33.6]] } }],
      }));
    }) as typeof fetch);
    const path = await provider.route([
      { latitude: "33.5", longitude: "36.2" },
      { latitude: "33.6", longitude: "36.3" },
    ]);
    expect(path.distanceMeters).toBe(2200);
    expect(path.coordinates).toHaveLength(3);
  });

  it("asks the table service for road distances between the driver and passengers", async () => {
    const provider = new OsrmRouteProvider("https://routes.example", (async (url) => {
      expect(String(url)).toContain("/table/v1/driving/36.2,33.5;36.4,33.7?annotations=distance");
      return new Response(JSON.stringify({ code: "Ok", distances: [[0, 800], [900, 0]] }));
    }) as typeof fetch);
    await expect(
      provider.distanceMatrix([
        { latitude: "33.5", longitude: "36.2" },
        { latitude: "33.7", longitude: "36.4" },
      ]),
    ).resolves.toEqual([
      [0, 800],
      [900, 0],
    ]);
  });
});
