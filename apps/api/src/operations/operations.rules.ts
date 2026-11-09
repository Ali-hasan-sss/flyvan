export const TRIP_STATUSES = [
  "PENDING_ASSIGNMENT",
  "OFFERED",
  "ASSIGNED",
  "DRIVER_ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
  "DISPUTED",
] as const;

export type TripStatusName = (typeof TRIP_STATUSES)[number];

const transitions: Record<TripStatusName, readonly TripStatusName[]> = {
  PENDING_ASSIGNMENT: ["OFFERED", "ASSIGNED", "CANCELLED"],
  OFFERED: ["ASSIGNED", "PENDING_ASSIGNMENT", "CANCELLED"],
  ASSIGNED: ["DRIVER_ARRIVED", "IN_PROGRESS", "NO_SHOW", "CANCELLED"],
  DRIVER_ARRIVED: ["IN_PROGRESS", "NO_SHOW", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "DISPUTED"],
  COMPLETED: ["DISPUTED"],
  NO_SHOW: [],
  CANCELLED: [],
  DISPUTED: [],
};

export function canTransitionTrip(from: TripStatusName, to: TripStatusName): boolean {
  return transitions[from].includes(to);
}

/** Dispatch may cancel a running trip after a breakdown report or after the automatic one-hour stall. Replacement stays outside the system. */
export function canCancelBrokenTrip(input: {
  actorCanDispatch: boolean;
  status: string;
  breakdownReported: boolean;
  arrivalStalled?: boolean;
}): boolean {
  return input.actorCanDispatch && input.status === "IN_PROGRESS" && (input.breakdownReported || input.arrivalStalled === true);
}

/** Quarter hour after the planned arrival stays on time. One hour after it, the open trip is stalled. */
export const ARRIVAL_GRACE_MS = 15 * 60 * 1000;
export const ARRIVAL_STALL_MS = 60 * 60 * 1000;
/** A driver may start at the planned departure, or up to one hour earlier, and not sooner. */
export const EARLY_START_MS = 60 * 60 * 1000;
/** Finish control is available inside a circle whose diameter is 1 km. */
export const DESTINATION_FINISH_RADIUS_METERS = 500;
/** Syria civil time. Daily routes repeat the arrival clock on this offset. */
const SERVICE_ZONE_OFFSET_MS = 3 * 60 * 60 * 1000;

const OPEN_ARRIVAL_STATUSES = new Set(["PENDING_ASSIGNMENT", "OFFERED", "ASSIGNED", "DRIVER_ARRIVED", "IN_PROGRESS"]);

export type ArrivalState = "ON_TIME" | "LATE" | "STALLED";

function serviceClock(instant: Date, isDaily: boolean, parentTripId: string | null, now: Date): Date {
  if (!isDaily || parentTripId) return instant;
  const local = new Date(instant.getTime() + SERVICE_ZONE_OFFSET_MS);
  const today = new Date(now.getTime() + SERVICE_ZONE_OFFSET_MS);
  const projected = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds()) -
      SERVICE_ZONE_OFFSET_MS,
  );
  return projected.getTime() < instant.getTime() ? instant : projected;
}

export function serviceArrivesAt(
  input: { arrivesAt: Date; isDaily: boolean; parentTripId: string | null },
  now: Date,
): Date {
  return serviceClock(input.arrivesAt, input.isDaily, input.parentTripId, now);
}

export function serviceDepartsAt(
  input: { scheduledAt: Date; isDaily: boolean; parentTripId: string | null },
  now: Date,
): Date {
  return serviceClock(input.scheduledAt, input.isDaily, input.parentTripId, now);
}

export function driverMayStartTrip(
  input: { scheduledAt: Date; isDaily: boolean; parentTripId: string | null },
  now: Date,
): boolean {
  return now.getTime() >= serviceDepartsAt(input, now).getTime() - EARLY_START_MS;
}

export function arrivalState(
  input: { arrivesAt: Date; isDaily: boolean; parentTripId: string | null; status: string },
  now: Date,
): ArrivalState {
  if (!OPEN_ARRIVAL_STATUSES.has(input.status)) return "ON_TIME";
  const elapsed = now.getTime() - serviceArrivesAt(input, now).getTime();
  if (elapsed >= ARRIVAL_STALL_MS) return "STALLED";
  if (elapsed > ARRIVAL_GRACE_MS) return "LATE";
  return "ON_TIME";
}

export function insideDestinationFinishCircle(distanceMetersValue: number): boolean {
  return Number.isFinite(distanceMetersValue) && distanceMetersValue >= 0 && distanceMetersValue <= DESTINATION_FINISH_RADIUS_METERS;
}

export function normalizeFare(value: string): string {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    return "";
  }
  const whole = match[1]?.replace(/^0+(?=\d)/, "") ?? "";
  const fraction = (match[2] ?? "").padEnd(2, "0");
  if (!whole || Number(whole) === 0 && fraction === "00") {
    return "";
  }
  return `${whole}.${fraction}`;
}

export function formatStoredFare(value: { toString(): string } | null): string | null {
  if (!value) return null;
  const raw = value.toString();
  return normalizeFare(raw) || raw;
}

export const PLATFORM_CURRENCY = "SYP";

export function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "";
}

export function formatDailyReference(prefix: "FV" | "TR", day: string, sequence: number): string {
  if (!/^\d{8}$/.test(day) || !Number.isInteger(sequence) || sequence < 1 || sequence > 9999) {
    return "";
  }
  return `${prefix}-${day}-${String(sequence).padStart(4, "0")}`;
}

export function formatBookingReference(day: string, sequence: number): string {
  return formatDailyReference("FV", day, sequence);
}

export function normalizeCoordinate(value: string, kind: "lat" | "lng"): string {
  const match = /^(-?)(\d{1,3})(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!match) return "";
  const sign = match[1] ?? "";
  const whole = match[2] ?? "";
  const fraction = match[3] ?? "";
  const scaled = Number(`${whole}${fraction.padEnd(6, "0")}`);
  const limit = kind === "lat" ? 90_000_000 : 180_000_000;
  if (!Number.isSafeInteger(scaled) || scaled > limit) return "";
  const trimmed = whole.replace(/^0+(?=\d)/, "");
  return fraction ? `${sign}${trimmed}.${fraction}` : `${sign}${trimmed}`;
}

const CURRENT_TRIP_STATUSES = new Set(["DRIVER_ARRIVED", "IN_PROGRESS"]);

export function selectDriverTrip<T extends { status: string; scheduledAt: Date }>(
  trips: T[],
): { trip: T; phase: "current" | "next" } | null {
  const byTime = (left: T, right: T) => left.scheduledAt.getTime() - right.scheduledAt.getTime();
  const current = trips.filter((trip) => CURRENT_TRIP_STATUSES.has(trip.status)).sort(byTime)[0];
  if (current) return { trip: current, phase: "current" };
  const next = trips.filter((trip) => trip.status === "ASSIGNED").sort(byTime)[0];
  if (next) return { trip: next, phase: "next" };
  return null;
}

export type RoadPoint = { latitude: number; longitude: number };

export function alignRouteLegs(
  path: { coordinates: RoadPoint[]; legs: { distanceMeters: number; durationSeconds: number; coordinates: RoadPoint[] }[] },
  stops: { kind: string; label: string; latitude: string; longitude: string }[],
): { targetKind: "pickup" | "destination"; label: string; distanceMeters: number; durationSeconds: number; coordinates: RoadPoint[] }[] {
  const routed = dedupeRouteStops(stops);
  if (routed.length < 2) return [];
  const provided = path.legs.length === routed.length - 1 ? path.legs : splitCoordinates(path.coordinates, routed);
  return provided.flatMap((leg, index) => {
    const target = routed[index + 1];
    if (!target || leg.coordinates.length < 2) return [];
    return [
      {
        targetKind: target.kind === "destination" ? ("destination" as const) : ("pickup" as const),
        label: target.label,
        distanceMeters: Math.round(leg.distanceMeters),
        durationSeconds: Math.round(leg.durationSeconds),
        coordinates: leg.coordinates,
      },
    ];
  });
}

function dedupeRouteStops<T extends { latitude: string; longitude: string }>(stops: T[]): T[] {
  const points: T[] = [];
  for (const stop of stops) {
    const previous = points[points.length - 1];
    if (previous && sameRoutePoint(previous.latitude, previous.longitude, stop.latitude, stop.longitude)) continue;
    points.push(stop);
  }
  return points;
}

function sameRoutePoint(leftLat: string, leftLng: string, rightLat: string, rightLng: string): boolean {
  return Math.abs(Number(leftLat) - Number(rightLat)) < 0.00001 && Math.abs(Number(leftLng) - Number(rightLng)) < 0.00001;
}

function splitCoordinates(
  coordinates: RoadPoint[],
  stops: { latitude: string; longitude: string }[],
): { distanceMeters: number; durationSeconds: number; coordinates: RoadPoint[] }[] {
  if (coordinates.length < 2 || stops.length < 2) return [];
  const cuts = [0];
  let cursor = 0;
  for (const stop of stops.slice(1)) {
    const targetLat = Number(stop.latitude);
    const targetLng = Number(stop.longitude);
    let best = cursor;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = cursor; index < coordinates.length; index += 1) {
      const point = coordinates[index];
      if (!point) continue;
      const distance = Math.hypot(point.latitude - targetLat, point.longitude - targetLng);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    if (best <= cursor) best = Math.min(coordinates.length - 1, cursor + 1);
    cuts.push(best);
    cursor = best;
  }
  const legs = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const start = cuts[index] ?? 0;
    const end = cuts[index + 1] ?? start;
    const slice = coordinates.slice(start, end + 1);
    if (slice.length < 2) continue;
    legs.push({ distanceMeters: 0, durationSeconds: 0, coordinates: slice });
  }
  return legs;
}

export function nearestPassengerOrder(distances: number[][], passengerCount: number): number[] {
  if (passengerCount < 1) return [];
  const width = passengerCount + 1;
  if (distances.length !== width || distances.some((row) => row.length !== width)) return [];
  const remaining = Array.from({ length: passengerCount }, (_, index) => index + 1);
  const order: number[] = [];
  let current = 0;
  while (remaining.length > 0) {
    let bestAt = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      if (candidate === undefined) continue;
      const distance = distances[current]?.[candidate];
      if (typeof distance !== "number" || !Number.isFinite(distance)) continue;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestAt = index;
      }
    }
    if (bestAt < 0) return [];
    const next = remaining.splice(bestAt, 1)[0];
    if (next === undefined) return [];
    order.push(next - 1);
    current = next;
  }
  return order;
}

export function routeStopOrder<T extends { pickupAt: Date | null }>(passengers: T[]): T[] {
  return [...passengers].sort((left, right) => {
    const leftTime = left.pickupAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightTime = right.pickupAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return leftTime - rightTime;
  });
}

export function revealPassengerDetails(input: { seeAll: boolean; assignedToViewer: boolean }): boolean {
  return input.seeAll || input.assignedToViewer;
}

/** Fewest linked vehicles, largest first, whose seats cover the bookings. */
export function planVehicleNeed(
  bookingCount: number,
  capacities: number[],
): { needed: number; seats: number; shortfall: number } {
  const usable = capacities.filter((capacity) => Number.isInteger(capacity) && capacity > 0);
  const seats = usable.reduce((sum, capacity) => sum + capacity, 0);
  if (!Number.isInteger(bookingCount) || bookingCount <= 0) return { needed: 0, seats, shortfall: 0 };
  const sorted = [...usable].sort((left, right) => right - left);
  let covered = 0;
  let needed = 0;
  for (const capacity of sorted) {
    if (covered >= bookingCount) break;
    covered += capacity;
    needed += 1;
  }
  return { needed, seats, shortfall: Math.max(0, bookingCount - seats) };
}

export function rankByStraightLine<T extends { latitude: number | null; longitude: number | null }>(
  originLatitude: number,
  originLongitude: number,
  passengers: T[],
): { passenger: T; distanceMeters: number | null }[] {
  return passengers
    .map((passenger) => {
      if (
        passenger.latitude === null ||
        passenger.longitude === null ||
        !Number.isFinite(passenger.latitude) ||
        !Number.isFinite(passenger.longitude)
      ) {
        return { passenger, distanceMeters: null as number | null };
      }
      return {
        passenger,
        distanceMeters: Math.round(distanceMeters(originLatitude, originLongitude, passenger.latitude, passenger.longitude)),
      };
    })
    .sort((left, right) => {
      if (left.distanceMeters === null) return 1;
      if (right.distanceMeters === null) return -1;
      return left.distanceMeters - right.distanceMeters;
    });
}

export function distanceMeters(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latDelta = toRadians(toLat - fromLat);
  const lngDelta = toRadians(toLng - fromLng);
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);
  const arc = Math.sin(latDelta / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDelta / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(arc)));
}

export function planPickupTimes(input: {
  departsAt: Date;
  arrivesAt: Date;
  destinationLatitude: number;
  destinationLongitude: number;
  passengers: { id: string; latitude: number; longitude: number }[];
}): { id: string; pickupAt: Date }[] {
  const windowMs = input.arrivesAt.getTime() - input.departsAt.getTime();
  if (windowMs <= 0 || input.passengers.length === 0) return [];
  const ranked = [...input.passengers].sort((left, right) => {
    const leftDistance = distanceMeters(left.latitude, left.longitude, input.destinationLatitude, input.destinationLongitude);
    const rightDistance = distanceMeters(right.latitude, right.longitude, input.destinationLatitude, input.destinationLongitude);
    return rightDistance - leftDistance;
  });
  const gap = ranked.length === 1 ? 0 : Math.min(5 * 60 * 1000, Math.floor(windowMs / ranked.length));
  return ranked.map((passenger, index) => ({
    id: passenger.id,
    pickupAt: new Date(input.departsAt.getTime() + index * gap),
  }));
}
