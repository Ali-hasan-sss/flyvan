export type AreaPreference = "TARGET" | "EXCLUDED";
export type AreaLinkStatus = "PENDING" | "APPROVED" | "REJECTED" | "ENDED";
export type OfferSourceName = "NEARBY" | "SERVICE_AREA";

export type AreaLink = {
  status: AreaLinkStatus;
  preference: AreaPreference;
  areaActive: boolean;
};

export type OfferDecision =
  | { allowed: true; source: OfferSourceName; reason: string }
  | { allowed: false; reason: string };

const EARTH_RADIUS_METERS = 6_371_000;

export function straightLineMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const startLatitude = toRadians(from.latitude);
  const endLatitude = toRadians(to.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine))));
}

export function decideOffer(input: {
  driverApproved: boolean;
  vehicleApproved: boolean;
  assignmentBlocked: boolean;
  acceptsNearby: boolean;
  nearbyRadiusMeters: number;
  straightLineMeters: number | null;
  area: AreaLink | null;
}): OfferDecision {
  if (!input.driverApproved) {
    return { allowed: false, reason: "السائق غير معتمد." };
  }
  if (!input.vehicleApproved) {
    return { allowed: false, reason: "المركبة غير معتمدة." };
  }
  if (input.assignmentBlocked) {
    return { allowed: false, reason: "الإسناد موقوف إداريًا لهذا السائق." };
  }

  const area = input.area;
  if (area?.areaActive && area.status === "APPROVED" && area.preference === "EXCLUDED") {
    return { allowed: false, reason: "الطلب داخل منطقة استبعدها السائق." };
  }
  if (area?.areaActive && area.status === "APPROVED" && area.preference === "TARGET") {
    return {
      allowed: true,
      source: "SERVICE_AREA",
      reason: "الطلب داخل منطقة خدمة وافق السائق على العمل فيها.",
    };
  }

  const distance = input.straightLineMeters;
  if (
    input.acceptsNearby &&
    distance !== null &&
    distance <= input.nearbyRadiusMeters
  ) {
    return {
      allowed: true,
      source: "NEARBY",
      reason: "الطلب ضمن نصف قطر الطلبات القريبة من موقع السائق.",
    };
  }

  return {
    allowed: false,
    reason: "الطلب ليس ضمن منطقة خدمة معتمدة ولا ضمن نصف قطر الطلبات القريبة.",
  };
}
