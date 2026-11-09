import { BadGatewayException, BadRequestException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMapTileCache, loadOsmTile, parseTileCoordinate, requireTileCoordinate } from "./map-tiles";

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function imageResponse(): Response {
  return {
    ok: true,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "image/png" : null) },
    arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
  } as Response;
}

describe("OpenStreetMap tiles", () => {
  afterEach(() => {
    clearMapTileCache();
    vi.unstubAllGlobals();
  });

  it("accepts a tile coordinate and ignores a png suffix", () => {
    expect(parseTileCoordinate("12", "2412", "1574.png")).toEqual({ z: 12, x: 2412, y: 1574 });
    expect(parseTileCoordinate("20", "0", "0")).toBeNull();
    expect(parseTileCoordinate("2", "9", "0")).toBeNull();
    expect(() => requireTileCoordinate("nope", "0", "0")).toThrow(BadRequestException);
  });

  it("loads a tile from OpenStreetMap once and then serves the cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());
    const first = await loadOsmTile(12, 2412, 1574, fetchMock);
    const second = await loadOsmTile(12, 2412, 1574, fetchMock);
    expect(first.body).toEqual(png);
    expect(first.contentType).toBe("image/png");
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://tile.openstreetmap.org/12/2412/1574.png");
  });

  it("rejects an upstream failure without caching it", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, headers: { get: () => null } });
    await expect(loadOsmTile(12, 1, 1, fetchMock)).rejects.toBeInstanceOf(BadGatewayException);
    await expect(loadOsmTile(12, 1, 1, fetchMock)).rejects.toBeInstanceOf(BadGatewayException);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
