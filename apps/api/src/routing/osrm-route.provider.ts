import {
  RouteProviderNotConfiguredError,
  UnconfiguredRouteProvider,
  type GeoPoint,
  type RouteEstimate,
  type RouteEstimateInput,
  type RoutePath,
  type RouteProvider,
} from "@flyvan/types";

const PUBLIC_OSRM_URL = "https://router.project-osrm.org";

export class OsrmRouteError extends Error {
  constructor(readonly reason: "http" | "empty" | "noroute") {
    super(reason);
    this.name = "OsrmRouteError";
  }
}

export function parseOsrmTable(body: unknown, size: number): number[][] {
  if (!body || typeof body !== "object") throw new OsrmRouteError("empty");
  const record = body as { code?: string; distances?: unknown };
  if (record.code === "NoRoute") throw new OsrmRouteError("noroute");
  if (record.code !== "Ok" || !Array.isArray(record.distances) || record.distances.length !== size) {
    throw new OsrmRouteError("empty");
  }
  return record.distances.map((row) => {
    if (!Array.isArray(row) || row.length !== size) throw new OsrmRouteError("empty");
    return row.map((value) => {
      if (value === null) return Number.NaN;
      const distance = Number(value);
      if (!Number.isFinite(distance) || distance < 0) throw new OsrmRouteError("empty");
      return distance;
    });
  });
}

export function parseOsrmRoute(body: unknown, provider = "osrm"): RoutePath {
  if (!body || typeof body !== "object") throw new OsrmRouteError("empty");
  const record = body as {
    code?: string;
    routes?: { distance?: number; duration?: number; geometry?: { coordinates?: unknown }; legs?: unknown }[];
  };
  if (record.code === "NoRoute") throw new OsrmRouteError("noroute");
  const route = record.routes?.[0];
  const rawCoordinates = route?.geometry?.coordinates;
  const distance = route?.distance;
  const duration = route?.duration;
  if (
    record.code !== "Ok" ||
    !Array.isArray(rawCoordinates) ||
    typeof distance !== "number" ||
    typeof duration !== "number" ||
    !Number.isFinite(distance) ||
    !Number.isFinite(duration) ||
    distance < 0 ||
    duration < 0
  ) {
    throw new OsrmRouteError("empty");
  }
  const coordinates = readCoordinatePairs(rawCoordinates);
  if (coordinates.length < 2) throw new OsrmRouteError("empty");
  const legs = readRouteLegs(route ?? {});
  return {
    distanceMeters: distance,
    durationSeconds: duration,
    provider,
    coordinates,
    legs: legs.length > 0 ? legs : [{ distanceMeters: distance, durationSeconds: duration, coordinates }],
  };
}

function readCoordinatePairs(raw: unknown): { latitude: number; longitude: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((pair) => {
    if (!Array.isArray(pair) || pair.length < 2) return [];
    const longitude = Number(pair[0]);
    const latitude = Number(pair[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    return [{ latitude, longitude }];
  });
}

function readRouteLegs(route: { legs?: unknown }): { distanceMeters: number; durationSeconds: number; coordinates: { latitude: number; longitude: number }[] }[] {
  if (!Array.isArray(route.legs)) return [];
  return route.legs.flatMap((leg) => {
    if (!leg || typeof leg !== "object") return [];
    const record = leg as { distance?: number; duration?: number; steps?: unknown };
    const distanceMeters = Number(record.distance);
    const durationSeconds = Number(record.duration);
    if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) return [];
    const coordinates: { latitude: number; longitude: number }[] = [];
    if (Array.isArray(record.steps)) {
      for (const step of record.steps) {
        if (!step || typeof step !== "object") continue;
        const geometry = (step as { geometry?: { coordinates?: unknown } }).geometry?.coordinates;
        for (const point of readCoordinatePairs(geometry)) {
          const previous = coordinates[coordinates.length - 1];
          if (previous && previous.latitude === point.latitude && previous.longitude === point.longitude) continue;
          coordinates.push(point);
        }
      }
    }
    if (coordinates.length < 2) return [];
    return [{ distanceMeters, durationSeconds, coordinates }];
  });
}

export class OsrmRouteProvider implements RouteProvider {
  readonly id = "osrm";

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  isConfigured(): boolean {
    return this.baseUrl.trim().length > 0;
  }

  async estimate(input: RouteEstimateInput): Promise<RouteEstimate> {
    const path = await this.route([input.origin, input.destination]);
    return { distanceMeters: path.distanceMeters, durationSeconds: path.durationSeconds, provider: path.provider };
  }

  async distanceMatrix(points: GeoPoint[]): Promise<number[][]> {
    const clean = points.flatMap((point) => {
      const latitude = Number(point.latitude);
      const longitude = Number(point.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
      return [`${longitude},${latitude}`];
    });
    if (clean.length !== points.length || clean.length < 2) throw new OsrmRouteError("empty");
    const url = `${this.baseUrl.replace(/\/$/, "")}/table/v1/driving/${clean.join(";")}?annotations=distance`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    } catch {
      throw new OsrmRouteError("http");
    }
    if (!response.ok) throw new OsrmRouteError("http");
    return parseOsrmTable(await response.json(), clean.length);
  }

  async route(stops: GeoPoint[]): Promise<RoutePath> {
    const points = dedupeStops(stops);
    if (points.length < 2) throw new OsrmRouteError("empty");
    const coordinates = points.map((stop) => `${Number(stop.longitude)},${Number(stop.latitude)}`).join(";");
    // A two-way road may U-turn at a pickup so the nearest approach is used. One-way streets stay one-way in the driving graph.
    const url = `${this.baseUrl.replace(/\/$/, "")}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true&continue_straight=false`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    } catch {
      throw new OsrmRouteError("http");
    }
    if (!response.ok) throw new OsrmRouteError("http");
    return parseOsrmRoute(await response.json(), this.id);
  }
}

export function createRouteProvider(): RouteProvider {
  const configured = process.env.ROUTE_OSRM_URL?.trim();
  const baseUrl = configured === undefined || configured === "" ? PUBLIC_OSRM_URL : configured;
  if (baseUrl === "off") return new UnconfiguredRouteProvider();
  return new OsrmRouteProvider(baseUrl);
}

export function isRouteProviderNotConfigured(error: unknown): boolean {
  return error instanceof RouteProviderNotConfiguredError;
}

function dedupeStops(stops: GeoPoint[]): GeoPoint[] {
  const points: GeoPoint[] = [];
  for (const stop of stops) {
    const latitude = Number(stop.latitude);
    const longitude = Number(stop.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const previous = points[points.length - 1];
    if (
      previous &&
      Math.abs(Number(previous.latitude) - latitude) < 0.00001 &&
      Math.abs(Number(previous.longitude) - longitude) < 0.00001
    ) {
      continue;
    }
    points.push({ latitude: latitude.toString(), longitude: longitude.toString() });
  }
  return points;
}
