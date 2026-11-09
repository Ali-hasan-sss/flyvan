export type SharedPoint = {
  latitude: number;
  longitude: number;
};

function accept(latitude: number, longitude: number): SharedPoint | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function parsePair(text: string): SharedPoint | null {
  const match = text.match(/(-?\d{1,3}(?:\.\d+)?)\s*[,،]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!match?.[1] || !match[2]) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (Math.abs(first) > 90 && Math.abs(second) <= 90) return accept(second, first);
  return accept(first, second);
}

function dmsToDecimal(degrees: number, minutes: number, seconds: number, negative: boolean): number {
  const value = degrees + minutes / 60 + seconds / 3600;
  return negative ? -value : value;
}

function parseDms(text: string): SharedPoint | null {
  const match = text.match(
    /(\d{1,3})\s*[°º]\s*(\d{1,2})\s*[′']\s*(\d{1,2}(?:\.\d+)?)\s*[″"]?\s*([NSns])\s*[,،]?\s*(\d{1,3})\s*[°º]\s*(\d{1,2})\s*[′']\s*(\d{1,2}(?:\.\d+)?)\s*[″"]?\s*([EWew])/,
  );
  if (!match) return null;
  const latitude = dmsToDecimal(Number(match[1]), Number(match[2]), Number(match[3]), match[4]?.toUpperCase() === "S");
  const longitude = dmsToDecimal(Number(match[5]), Number(match[6]), Number(match[7]), match[8]?.toUpperCase() === "W");
  return accept(latitude, longitude);
}

function parseMapsUrl(value: string): SharedPoint | null {
  const geo = value.match(/^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (geo?.[1] && geo[2]) return accept(Number(geo[1]), Number(geo[2]));

  const place = value.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (place?.[1] && place[2]) return accept(Number(place[1]), Number(place[2]));

  const at = value.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at?.[1] && at[2]) return accept(Number(at[1]), Number(at[2]));

  try {
    const url = new URL(value);
    for (const key of ["q", "ll", "query", "destination", "daddr"]) {
      const raw = url.searchParams.get(key);
      if (!raw) continue;
      const point = parsePair(decodeURIComponent(raw));
      if (point) return point;
    }
  } catch {
    return null;
  }
  return null;
}

export function parseSharedLocation(value: string): SharedPoint | null {
  const text = value.trim();
  if (!text) return null;
  const url = text.match(/https?:\/\/[^\s<>"']+/i)?.[0] ?? (text.toLowerCase().startsWith("geo:") ? text : "");
  const fromUrl = url ? parseMapsUrl(url) : null;
  if (fromUrl) return fromUrl;
  return parseDms(text) ?? parsePair(text);
}

export function isShortMapsLink(value: string): boolean {
  const url = value.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "maps.app.goo.gl" || host === "goo.gl";
  } catch {
    return false;
  }
}
