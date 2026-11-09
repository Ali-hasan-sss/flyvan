import { BadGatewayException, BadRequestException } from "@nestjs/common";
import { normalizeCoordinate } from "./operations.rules";

export type PlaceMatch = {
  label: string;
  latitude: string;
  longitude: string;
};

const SEARCH_ORIGIN = "https://nominatim.openstreetmap.org/search";

export function readPlaceMatches(payload: unknown): PlaceMatch[] {
  if (!Array.isArray(payload)) return [];
  const matches: PlaceMatch[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const row = item as { lat?: unknown; lon?: unknown; display_name?: unknown };
    const latitude = coordinateText(row.lat, "lat");
    const longitude = coordinateText(row.lon, "lng");
    const label = typeof row.display_name === "string" ? row.display_name.replace(/\s+/g, " ").trim() : "";
    if (!latitude || !longitude || label.length < 2) continue;
    matches.push({ label, latitude, longitude });
    if (matches.length === 6) break;
  }
  return matches;
}

export async function searchPlaces(query: string, fetchImpl: typeof fetch = fetch): Promise<PlaceMatch[]> {
  const q = query.trim().replace(/\s+/g, " ");
  if (q.length < 2 || q.length > 80 || /https?:/i.test(q)) {
    throw new BadRequestException("اكتب اسم المنطقة أو العنوان.");
  }
  const url = new URL(SEARCH_ORIGIN);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "6");
  url.searchParams.set("countrycodes", "sy");
  url.searchParams.set("accept-language", "ar");
  url.searchParams.set("viewbox", "35.5,36.0,37.2,34.4");
  url.searchParams.set("bounded", "0");
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": "FlyVan/1.0 (dispatch place search)",
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new BadGatewayException("تعذر البحث عن العنوان.");
  }
  if (!response.ok) throw new BadGatewayException("تعذر البحث عن العنوان.");
  return readPlaceMatches(await response.json());
}

function coordinateText(value: unknown, kind: "lat" | "lng"): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  const text = parsed.toFixed(6).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return normalizeCoordinate(text, kind);
}
