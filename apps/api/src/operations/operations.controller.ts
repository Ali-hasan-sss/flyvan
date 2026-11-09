import { Body, Controller, HttpCode, HttpException, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Delete, Get, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { CurrentUser } from "../auth/access.guard";
import { AttemptLimiter, RateLimitError } from "../auth/attempt-limiter";
import { RequirePermissions } from "../auth/permissions.decorator";
import { Public } from "../auth/public.decorator";
import type { PublicUser } from "../auth/public-user";
import { expandMapsLink } from "./location-link";
import {
  AdjustFareDto,
  ExpandLocationDto,
  AssignTripDto,
  BoardingDto,
  CompanyFareDto,
  CancelBookingDto,
  ConfirmBookingDto,
  CreateBookingDto,
  PublicBookingDto,
  DriverMapQueryDto,
  ConfirmRunDto,
  CreateTripDto,
  ListOperationsQueryDto,
  PreviewRunDto,
  OfferTripDto,
  ReportBreakdownDto,
  RespondOfferDto,
  SetTripOriginDto,
  TripStatusDto,
  UpsertDestinationDto,
} from "./operations.dto";
import { searchPlaces } from "./map-search";
import { throwOperationsHttp } from "./operations.errors";
import { OperationsService } from "./operations.service";
import type { TripStatusName } from "./operations.rules";

@ApiTags("bookings")
@ApiBearerAuth()
@Controller("bookings")
export class BookingsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  @ApiOperation({ summary: "قائمة الحجوزات" })
  list(@CurrentUser() actor: PublicUser, @Query() query: ListOperationsQueryDto) {
    return this.call(() =>
      this.operations.listBookings(actor, {
        page: query.page || 1,
        pageSize: query.pageSize || 10,
        search: query.q,
        sort: query.sort,
        direction: query.direction,
      }),
    );
  }

  @Post()
  @RequirePermissions("BOOKINGS_MANAGE", "FARE_LOCK")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "إنشاء حجز مؤكد بأجرة مثبتة ورحلة مستقلة، دون حساب راكب" })
  create(@CurrentUser() actor: PublicUser, @Body() body: CreateBookingDto) {
    return this.call(() => this.operations.createBooking(actor, body));
  }

  @Post(":id/confirm")
  @RequirePermissions("BOOKINGS_MANAGE", "FARE_LOCK")
  @ApiOperation({ summary: "تثبيت أجرة طلب الحجز العام وتأكيده" })
  confirm(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: ConfirmBookingDto) {
    return this.call(() => this.operations.confirmBooking(actor, id, body.fareAmount));
  }

  @Post(":id/fare")
  @RequirePermissions("FARE_ADJUST")
  @ApiOperation({ summary: "تعديل الأجرة بعد تثبيتها مع سبب وتدقيق" })
  adjust(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: AdjustFareDto) {
    return this.call(() =>
      this.operations.adjustFare(actor, id, body.tripId, body.fareAmount, body.reason),
    );
  }

  @Post(":id/cancel")
  @RequirePermissions("BOOKINGS_MANAGE")
  @ApiOperation({ summary: "إلغاء الحجز قبل بدء التنفيذ مع السبب" })
  cancel(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: CancelBookingDto) {
    return this.call(() => this.operations.cancelBooking(actor, id, body.reason));
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throwOperationsHttp(error);
    }
  }
}

@ApiTags("trips")
@ApiBearerAuth()
@Controller("trips")
export class TripsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  @ApiOperation({ summary: "قائمة الرحلات. السائق يرى المسند إليه والمعروض عليه فقط." })
  list(@CurrentUser() actor: PublicUser, @Query() query: ListOperationsQueryDto) {
    return this.call(() =>
      this.operations.listTrips(actor, {
        page: query.page || 1,
        pageSize: query.pageSize || 10,
        search: query.q,
        sort: query.sort,
        direction: query.direction,
        leg: query.leg,
        bookable: query.bookable,
        driverId: query.driverId,
      }),
    );
  }

  @Get("driver-map")
  @ApiOperation({ summary: "رحلة السائق الحالية أو التالية مع مسار الطريق من موقعه إلى أقرب راكب ثم الوجهة" })
  driverMap(@CurrentUser() actor: PublicUser, @Query() query: DriverMapQueryDto) {
    return this.call(() => this.operations.driverMap(actor, query.latitude, query.longitude));
  }

  @Get("breakdowns")
  @RequirePermissions("TRIPS_DISPATCH")
  @ApiOperation({ summary: "رحلات أبلغ سائقوها عن عطل أو حادث ولم تُغلق بعد" })
  breakdowns(@CurrentUser() actor: PublicUser) {
    return this.call(() => this.operations.listBreakdowns(actor));
  }

  @Get("candidates")
  @RequirePermissions("TRIPS_DISPATCH")
  @ApiOperation({ summary: "سائقون جاهزون للإسناد مع مركبتهم المعتمدة" })
  candidates(@CurrentUser() actor: PublicUser) {
    return this.call(() => this.operations.candidates(actor));
  }

  @Get(":id")
  @ApiOperation({ summary: "تفاصيل رحلة. الرحلة الدائمة تعرض مركباتها ورحلاتها الفرعية." })
  get(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.call(() => this.operations.getTrip(actor, id));
  }

  @Post()
  @RequirePermissions("TRIPS_DISPATCH")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "إنشاء رحلة ذهاب أو إياب مرتبطة بوجهة قبل أي حجز" })
  create(@CurrentUser() actor: PublicUser, @Body() body: CreateTripDto) {
    return this.call(() => this.operations.createTrip(actor, body));
  }

  @Patch(":id")
  @RequirePermissions("TRIPS_DISPATCH")
  @ApiOperation({ summary: "تعديل اتجاه الرحلة أو وجهتها أو موعدها قبل بدء الرحلة" })
  update(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: CreateTripDto) {
    return this.call(() => this.operations.updateTrip(actor, id, body));
  }

  @Post(":id/origin")
  @RequirePermissions("TRIPS_DISPATCH")
  @ApiOperation({ summary: "تحديد موقع انطلاق السائق لحساب مسار الطريق" })
  origin(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: SetTripOriginDto) {
    return this.call(() => this.operations.setTripOrigin(actor, id, body.latitude, body.longitude));
  }

  @Get(":id/route")
  @ApiOperation({ summary: "مسار الطريق من موقع السائق إلى الركاب ثم الوجهة، مع مسافة الطريق" })
  route(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.call(() => this.operations.tripRoute(actor, id));
  }

  @Post(":id/assign")
  @RequirePermissions("TRIPS_DISPATCH")
  @ApiOperation({ summary: "إسناد يدوي لسائق جاهز. فحص حد المديونية مؤجل لمرحلة العمولات." })
  assign(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: AssignTripDto) {
    return this.call(() => this.operations.assignTrip(actor, id, body.driverProfileId));
  }

  @Post(":id/runs/preview")
  @RequirePermissions("TRIPS_DISPATCH")
  @ApiOperation({ summary: "اقتراح أقرب الركاب لسائق مركبة واحدة بحسب مقاعدها، دون تثبيت الرحلة" })
  previewRun(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: PreviewRunDto) {
    return this.call(() => this.operations.previewRun(actor, id, body));
  }

  @Post(":id/runs")
  @RequirePermissions("TRIPS_DISPATCH")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "تأكيد رحلة فرعية لمركبة واحدة ومرة واحدة، بعد اختيار الركاب" })
  confirmRun(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: ConfirmRunDto) {
    return this.call(() => this.operations.confirmRun(actor, id, body));
  }

  @Post(":id/vehicles")
  @RequirePermissions("TRIPS_DISPATCH")
  @ApiOperation({ summary: "ربط مركبة بالرحلة. الأولى تسند الرحلة، والإضافية تزيد المقاعد دون استبدال المركبة الأساسية." })
  linkVehicle(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: AssignTripDto) {
    return this.call(() => this.operations.linkVehicle(actor, id, body.driverProfileId));
  }

  @Post(":id/vehicles/:vehicleId/replace")
  @RequirePermissions("TRIPS_DISPATCH")
  @ApiOperation({ summary: "استبدال مركبة وسائقها بمركبة أخرى قبل بدء الرحلة" })
  replaceVehicle(
    @CurrentUser() actor: PublicUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("vehicleId", ParseUUIDPipe) vehicleId: string,
    @Body() body: AssignTripDto,
  ) {
    return this.call(() => this.operations.replaceVehicle(actor, id, vehicleId, body.driverProfileId));
  }

  @Post(":id/vehicles/:vehicleId/disable")
  @RequirePermissions("TRIPS_DISPATCH")
  @ApiOperation({ summary: "تعطيل مركبة واحدة. الرحلة تبقى على حالتها وتعمل ببقية المركبات." })
  disableVehicle(
    @CurrentUser() actor: PublicUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("vehicleId", ParseUUIDPipe) vehicleId: string,
    @Body() body: CancelBookingDto,
  ) {
    return this.call(() => this.operations.disableVehicle(actor, id, vehicleId, body.reason));
  }

  @Delete(":id/vehicles/:vehicleId")
  @RequirePermissions("TRIPS_DISPATCH")
  @ApiOperation({ summary: "فك مركبة مرتبطة قبل بدء الرحلة إذا بقيت المقاعد كافية." })
  unlinkVehicle(
    @CurrentUser() actor: PublicUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("vehicleId", ParseUUIDPipe) vehicleId: string,
  ) {
    return this.call(() => this.operations.unlinkVehicle(actor, id, vehicleId));
  }

  @Delete(":id")
  @RequirePermissions("TRIPS_DISPATCH")
  @ApiOperation({ summary: "حذف رحلة لم تبدأ وليس لها عمولة. حجوزاتها التي لا يبقى لها اتجاه تُلغى." })
  remove(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: CancelBookingDto) {
    return this.call(() => this.operations.deleteTrip(actor, id, body.reason));
  }

  @Post(":id/offers")
  @RequirePermissions("TRIPS_DISPATCH")
  @ApiOperation({ summary: "عرض الرحلة على سائق إذا وافقت قواعد القرب أو منطقة الخدمة" })
  offer(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: OfferTripDto) {
    return this.call(() => this.operations.offerTrip(actor, id, body));
  }

  @Post(":id/breakdown")
  @ApiOperation({ summary: "بلاغ السائق بتعثر الرحلة لعطل أو حادث. لا يلغي الرحلة ولا يسند سائقًا آخر." })
  breakdown(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: ReportBreakdownDto) {
    return this.call(() => this.operations.reportBreakdown(actor, id, body.note));
  }

  @Post(":id/status")
  @ApiOperation({ summary: "نقل حالة الرحلة المسموح بها للسائق المعيّن أو للكونترول" })
  status(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: TripStatusDto) {
    return this.call(() =>
      this.operations.changeStatus(actor, id, body.status as TripStatusName, body.reason, body.occurredAt, {
        latitude: body.latitude,
        longitude: body.longitude,
      }),
    );
  }

  @Post(":id/passengers/:passengerId/company-fare")
  @RequirePermissions("TRIPS_DISPATCH")
  @ApiOperation({ summary: "تسجيل أن الراكب دفع أجرة هذا الاتجاه للإدارة، أو أنها ما زالت غير مدفوعة. ليس تسديد عمولة." })
  companyFare(
    @CurrentUser() actor: PublicUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("passengerId", ParseUUIDPipe) passengerId: string,
    @Body() body: CompanyFareDto,
  ) {
    return this.call(() => this.operations.setCompanyFarePaid(actor, id, passengerId, body.paid));
  }

  @Post(":id/passengers/:passengerId/boarding")
  @ApiOperation({ summary: "تسجيل صعود الراكب أو عدم حضوره" })
  boarding(
    @CurrentUser() actor: PublicUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("passengerId", ParseUUIDPipe) passengerId: string,
    @Body() body: BoardingDto,
  ) {
    return this.call(() => this.operations.recordBoarding(actor, id, passengerId, body));
  }

  @Post(":id/fare-collected")
  @ApiOperation({ summary: "تسجيل استلام أجرة الراكب النقدية. ليس تسديدًا لعمولة الشركة." })
  fareCollected(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.call(() => this.operations.markFareCollected(actor, id));
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throwOperationsHttp(error);
    }
  }
}

@ApiTags("destinations")
@ApiBearerAuth()
@Controller("destinations")
export class DestinationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  @RequirePermissions("TRIPS_DISPATCH")
  @ApiOperation({ summary: "وجهات المنصة ومواقعها على الخريطة" })
  list(@CurrentUser() actor: PublicUser) {
    return this.call(() => this.operations.listDestinations(actor));
  }

  @Post()
  @RequirePermissions("TRIPS_DISPATCH")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "إضافة وجهة بموقع على الخريطة" })
  create(@CurrentUser() actor: PublicUser, @Body() body: UpsertDestinationDto) {
    return this.call(() => this.operations.createDestination(actor, body));
  }

  @Patch(":id")
  @RequirePermissions("TRIPS_DISPATCH")
  @ApiOperation({ summary: "تعديل وجهة أو إيقافها" })
  update(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: UpsertDestinationDto) {
    return this.call(() => this.operations.updateDestination(actor, id, body));
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throwOperationsHttp(error);
    }
  }
}

@ApiTags("trips")
@ApiBearerAuth()
@Controller("trip-offers")
export class TripOffersController {
  constructor(private readonly operations: OperationsService) {}

  @Post(":id/respond")
  @RequirePermissions("TRIPS_OPERATE_OWN")
  @ApiOperation({ summary: "قبول عرض الرحلة أو رفضه من السائق المعني" })
  respond(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: RespondOfferDto) {
    return this.call(() => this.operations.respondOffer(actor, id, body.decision));
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throwOperationsHttp(error);
    }
  }
}

@ApiTags("locations")
@ApiBearerAuth()
@Controller("locations")
export class LocationsController {
  @Post("expand")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "توسيع رابط خرائط مختصر من واتساب أو جوجل" })
  expand(@Body() body: ExpandLocationDto) {
    return expandMapsLink(body.value);
  }
}

@ApiTags("public")
@Public()
@Controller("public")
export class PublicBookingController {
  private readonly attempts = new AttemptLimiter();

  constructor(private readonly operations: OperationsService) {}

  @Get("trips")
  @ApiOperation({ summary: "رحلات متاحة للحجز العام دون بيانات الركاب" })
  trips(@Req() request: Request) {
    this.limit(request, "trips", 40);
    return this.call(() => this.operations.listPublicTrips());
  }

  @Post("bookings")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "طلب حجز عام بانتظار تثبيت الأجرة" })
  create(@Req() request: Request, @Body() body: PublicBookingDto) {
    this.limit(request, "bookings", 6);
    return this.call(() => this.operations.requestPublicBooking(body));
  }

  @Get("places")
  @ApiOperation({ summary: "بحث عنوان لصفحة الحجز العامة" })
  async places(@Req() request: Request, @Query("q") q = ""): Promise<{ items: Awaited<ReturnType<typeof searchPlaces>> }> {
    this.limit(request, "places", 20);
    return { items: await searchPlaces(q) };
  }

  private limit(request: Request, action: string, max: number): void {
    const address = request.ip || request.socket.remoteAddress || "unknown";
    try {
      this.attempts.assertAllowed(`public:${action}:${address}`, max, 60_000);
    } catch (error) {
      if (error instanceof RateLimitError) {
        throw new HttpException("طلبات كثيرة. أعد المحاولة بعد دقيقة.", HttpStatus.TOO_MANY_REQUESTS);
      }
      throw error;
    }
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throwOperationsHttp(error);
    }
  }
}
