import { BadGatewayException, BadRequestException } from "@nestjs/common";

const OSM_TILE_ORIGIN = "https://tile.openstreetmap.org";
const TILE_CACHE_LIMIT = 512;
const TILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CachedTile = {
  body: Uint8Array;
  contentType: string;
  storedAt: number;
};

const tileCache = new Map<string, CachedTile>();

export function parseTileCoordinate(
  zRaw: string,
  xRaw: string,
  yRaw: string,
): { z: number; x: number; y: number } | null {
  const z = readIndex(zRaw);
  const x = readIndex(xRaw.replace(/\.png$/i, ""));
  const y = readIndex(yRaw.replace(/\.png$/i, ""));
  if (z === null || x === null || y === null || z > 19) return null;
  const limit = 2 ** z;
  if (x >= limit || y >= limit) return null;
  return { z, x, y };
}

export function clearMapTileCache(): void {
  tileCache.clear();
}

export async function loadOsmTile(
  z: number,
  x: number,
  y: number,
  fetchImpl: typeof fetch = fetch,
): Promise<CachedTile> {
  const key = `${z}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached && Date.now() - cached.storedAt < TILE_CACHE_TTL_MS) return cached;

  let response: Response;
  try {
    response = await fetchImpl(`${OSM_TILE_ORIGIN}/${key}.png`, {
      headers: {
        accept: "image/png,image/*",
        "user-agent": "FlyVan/1.0 (booking map)",
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new BadGatewayException("تعذر الاتصال بـ OpenStreetMap.");
  }

  if (!response.ok) {
    throw new BadGatewayException("تعذر جلب الخريطة من OpenStreetMap.");
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  if (!contentType.startsWith("image/")) {
    throw new BadGatewayException("تعذر جلب الخريطة من OpenStreetMap.");
  }

  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > 1_500_000) {
    throw new BadGatewayException("تعذر جلب الخريطة من OpenStreetMap.");
  }

  const tile = { body, contentType, storedAt: Date.now() };
  tileCache.set(key, tile);
  if (tileCache.size > TILE_CACHE_LIMIT) {
    const oldest = tileCache.keys().next().value;
    if (oldest) tileCache.delete(oldest);
  }
  return tile;
}

function readIndex(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return null;
  return parsed;
}

export function requireTileCoordinate(zRaw: string, xRaw: string, yRaw: string): { z: number; x: number; y: number } {
  const coordinate = parseTileCoordinate(zRaw, xRaw, yRaw);
  if (!coordinate) throw new BadRequestException("إحداثيات بلاطة الخريطة غير صالحة.");
  return coordinate;
}
