export type GeoPoint = {
  latitude: string;
  longitude: string;
};

export type RouteEstimateInput = {
  origin: GeoPoint;
  destination: GeoPoint;
};

export type RouteEstimate = {
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
};

export type RouteLeg = {
  distanceMeters: number;
  durationSeconds: number;
  coordinates: { latitude: number; longitude: number }[];
};

export type RoutePath = {
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
  coordinates: { latitude: number; longitude: number }[];
  legs: RouteLeg[];
};

export class RouteProviderNotConfiguredError extends Error {
  readonly code = "ROUTE_PROVIDER_NOT_CONFIGURED";

  constructor() {
    super("No route provider is configured. Road time is unavailable.");
    this.name = "RouteProviderNotConfiguredError";
  }
}

export interface RouteProvider {
  readonly id: string;
  isConfigured(): boolean;
  estimate(input: RouteEstimateInput): Promise<RouteEstimate>;
  route(stops: GeoPoint[]): Promise<RoutePath>;
  distanceMatrix(points: GeoPoint[]): Promise<number[][]>;
}

export class UnconfiguredRouteProvider implements RouteProvider {
  readonly id = "unconfigured";

  isConfigured(): boolean {
    return false;
  }

  estimate(_input: RouteEstimateInput): Promise<RouteEstimate> {
    return Promise.reject(new RouteProviderNotConfiguredError());
  }

  route(_stops: GeoPoint[]): Promise<RoutePath> {
    return Promise.reject(new RouteProviderNotConfiguredError());
  }

  distanceMatrix(_points: GeoPoint[]): Promise<number[][]> {
    return Promise.reject(new RouteProviderNotConfiguredError());
  }
}
