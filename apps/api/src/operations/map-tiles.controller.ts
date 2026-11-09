import { Controller, Get, Header, Param, Query, StreamableFile } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator";
import { RequirePermissions } from "../auth/permissions.decorator";
import { searchPlaces } from "./map-search";
import { loadOsmTile, requireTileCoordinate } from "./map-tiles";

@ApiTags("maps")
@Controller("maps")
export class MapsController {
  @Get("search")
  @RequirePermissions("BOOKINGS_MANAGE")
  @ApiOperation({ summary: "البحث عن عنوان أو منطقة داخل سوريا لتحديد موقع الراكب" })
  async search(@Query("q") q = ""): Promise<{ items: Awaited<ReturnType<typeof searchPlaces>> }> {
    return { items: await searchPlaces(q) };
  }

  @Public()
  @Get("tiles/:z/:x/:y")
  @Header("Cache-Control", "public, max-age=86400")
  @ApiOperation({ summary: "بلاطة خريطة من OpenStreetMap لنموذج الحجز" })
  async tile(@Param("z") z: string, @Param("x") x: string, @Param("y") y: string): Promise<StreamableFile> {
    const coordinate = requireTileCoordinate(z, x, y);
    const tile = await loadOsmTile(coordinate.z, coordinate.x, coordinate.y);
    return new StreamableFile(tile.body, {
      type: tile.contentType,
      disposition: `inline; filename="${coordinate.z}-${coordinate.x}-${coordinate.y}.png"`,
    });
  }
}
