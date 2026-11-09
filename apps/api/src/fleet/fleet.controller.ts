import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { driverPhotoInterceptor } from "../files/driver-photo.interceptor";
import { vehicleFilesInterceptor } from "../files/vehicle-files.interceptor";
import { CurrentUser } from "../auth/access.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import type { PublicUser } from "../auth/public-user";
import {
  ApprovalDto,
  AssignVehicleDto,
  AssignmentHoldDto,
  CreateDocumentDto,
  CreateDriverDto,
  CreateServiceAreaDto,
  CreateVehicleDto,
  ChangeDriverPasswordDto,
  ListDriversQueryDto,
  ListVehiclesQueryDto,
  UpdateDriverDto,
  UpdateVehicleDto,
  OfferPreviewDto,
  RequestServiceAreaDto,
  ReviewDocumentDto,
  ReviewServiceAreaLinkDto,
  UpdateDriverPreferencesDto,
  UpdateServiceAreaDto,
} from "./fleet.dto";
import { FleetError, throwFleetHttp } from "./fleet.errors";
import { FleetService } from "./fleet.service";

@ApiTags("drivers")
@ApiBearerAuth()
@Controller("drivers")
export class DriversController {
  constructor(private readonly fleet: FleetService) {}

  @Get("me")
  @RequirePermissions("OWN_PROFILE_VIEW")
  @ApiOperation({ summary: "ملف السائق الحالي" })
  me(@CurrentUser() actor: PublicUser) {
    return this.call(() => this.fleet.ownProfile(actor.id));
  }

  @Patch("me")
  @RequirePermissions("OWN_PROFILE_VIEW")
  @ApiOperation({ summary: "تحديث نصف قطر الطلبات القريبة" })
  updateMe(@CurrentUser() actor: PublicUser, @Body() body: UpdateDriverPreferencesDto) {
    return this.call(() => this.fleet.updateOwnPreferences(actor.id, body));
  }

  @Post("me/service-areas")
  @RequirePermissions("OWN_SERVICE_AREAS_MANAGE")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "طلب ربط منطقة خدمة. القبول يبقى مراجعة منفصلة ولا يسند رحلة." })
  requestArea(@CurrentUser() actor: PublicUser, @Body() body: RequestServiceAreaDto) {
    return this.call(() => this.fleet.requestOwnArea(actor.id, body.serviceAreaId, body.preference));
  }

  @Get()
  @RequirePermissions("DRIVERS_REVIEW")
  @ApiOperation({ summary: "قائمة السائقين مع الترتيب والتصفح" })
  list(@Query() query: ListDriversQueryDto) {
    return this.fleet.listDrivers({
      page: query.page || 1,
      pageSize: query.pageSize || 10,
      sort: query.sort || "createdAt",
      direction: query.direction || "desc",
      deleted: query.deleted === true,
      search: query.q,
    });
  }

  @Post()
  @RequirePermissions("DRIVERS_REVIEW")
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(vehicleFilesInterceptor)
  @ApiOperation({ summary: "إنشاء سائق، مع مركبة أساسية اختيارية وصورة مطلوبة إن وُجدت مركبة" })
  create(
    @CurrentUser() actor: PublicUser,
    @Body() body: CreateDriverDto,
    @UploadedFiles()
    files?: { vehicleImage?: Express.Multer.File[]; vehicleDocument?: Express.Multer.File[] },
  ) {
    const vehicle =
      body.vehicle ??
      (body.plateNumber || body.vehicleType || body.capacity !== undefined
        ? {
            plateNumber: body.plateNumber ?? "",
            capacity: body.capacity ?? 0,
            vehicleType: body.vehicleType ?? "",
          }
        : undefined);
    return this.call(() =>
      this.fleet.createDriver(actor.id, {
        ...body,
        vehicle,
        image: files?.vehicleImage?.[0],
        document: files?.vehicleDocument?.[0],
      }),
    );
  }

  @Get(":id")
  @RequirePermissions("DRIVERS_REVIEW")
  @ApiOperation({ summary: "تفاصيل سائق ووثائقه ومناطقه وإحصاءاته" })
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.call(() => this.fleet.getDriver(id));
  }

  @Patch(":id")
  @RequirePermissions("DRIVERS_REVIEW")
  @UseInterceptors(driverPhotoInterceptor)
  @ApiOperation({ summary: "تعديل بيانات السائق وصورته الاختيارية" })
  update(
    @CurrentUser() actor: PublicUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateDriverDto,
    @UploadedFile() photo?: Express.Multer.File,
  ) {
    return this.call(() => this.fleet.updateDriver(actor.id, id, { ...body, photo }));
  }

  @Post(":id/password")
  @RequirePermissions("DRIVERS_REVIEW")
  @ApiOperation({ summary: "تغيير كلمة مرور السائق" })
  changePassword(
    @CurrentUser() actor: PublicUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: ChangeDriverPasswordDto,
  ) {
    return this.call(() => this.fleet.changeDriverPassword(actor.id, id, body.password));
  }

  @Post(":id/approval")
  @RequirePermissions("DRIVERS_REVIEW")
  @ApiOperation({ summary: "تغيير اعتماد السائق. الاعتماد بلا سبب، وإلغاؤه يتطلب سببًا ووثيقة سارية." })
  approve(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: ApprovalDto) {
    return this.call(() => this.fleet.setDriverApproval(actor.id, id, body.status, body.reason));
  }

  @Post(":id/archive")
  @RequirePermissions("DRIVERS_REVIEW")
  @ApiOperation({ summary: "نقل السائق إلى المحذوفين دون حذف السجل" })
  archive(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.call(() => this.fleet.archiveDriver(actor.id, id));
  }

  @Post(":id/hold")
  @RequirePermissions("DRIVERS_REVIEW")
  @ApiOperation({ summary: "إيقاف إسناد الرحلات لهذا السائق فقط" })
  hold(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: AssignmentHoldDto) {
    return this.call(() => this.fleet.setAssignmentHold(actor.id, id, body.blocked, body.reason));
  }

  @Post(":id/documents")
  @RequirePermissions("DRIVERS_REVIEW")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "تسجيل بيانات وثيقة. لا يُرفع ملف في هذه المرحلة." })
  addDocument(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: CreateDocumentDto) {
    return this.call(() => this.fleet.addDriverDocument(actor.id, id, body.kind, body.expiresOn));
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throwFleetHttp(error);
    }
  }
}

@ApiTags("drivers")
@ApiBearerAuth()
@Controller("driver-documents")
export class DriverDocumentsController {
  constructor(private readonly fleet: FleetService) {}

  @Post(":id/review")
  @RequirePermissions("DRIVERS_REVIEW")
  @ApiOperation({ summary: "مراجعة وثيقة سائق" })
  review(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: ReviewDocumentDto) {
    return this.call(() => this.fleet.reviewDriverDocument(actor.id, id, body.status));
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throwFleetHttp(error);
    }
  }
}

@ApiTags("vehicles")
@ApiBearerAuth()
@Controller("vehicles")
export class VehiclesController {
  constructor(private readonly fleet: FleetService) {}

  @Get()
  @RequirePermissions("VEHICLES_REVIEW")
  @ApiOperation({ summary: "قائمة المركبات مع الترتيب والتصفح والبحث" })
  list(@Query() query: ListVehiclesQueryDto) {
    return this.fleet.listVehicles({
      page: query.page || 1,
      pageSize: query.pageSize || 10,
      sort: query.sort || "createdAt",
      direction: query.direction || "desc",
      deleted: query.deleted,
      search: query.q,
    });
  }

  @Get(":id")
  @RequirePermissions("VEHICLES_REVIEW")
  @ApiOperation({ summary: "تفاصيل مركبة ووثائقها وإحصاءاتها" })
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.call(() => this.fleet.getVehicle(id));
  }

  @Patch(":id")
  @RequirePermissions("VEHICLES_REVIEW")
  @UseInterceptors(vehicleFilesInterceptor)
  @ApiOperation({ summary: "تعديل بيانات المركبة وصورتها ووثيقتها" })
  update(
    @CurrentUser() actor: PublicUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateVehicleDto,
    @UploadedFiles()
    files?: { vehicleImage?: Express.Multer.File[]; vehicleDocument?: Express.Multer.File[] },
  ) {
    return this.call(() =>
      this.fleet.updateVehicle(actor.id, id, {
        ...body,
        image: files?.vehicleImage?.[0],
        document: files?.vehicleDocument?.[0],
      }),
    );
  }

  @Post(":id/archive")
  @RequirePermissions("VEHICLES_REVIEW")
  @ApiOperation({ summary: "نقل المركبة إلى المحذوفين دون حذف السجل" })
  archive(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.call(() => this.fleet.archiveVehicle(actor.id, id));
  }

  @Post()
  @RequirePermissions("VEHICLES_REVIEW")
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(vehicleFilesInterceptor)
  @ApiOperation({ summary: "تسجيل مركبة مع صورة مطلوبة ووثيقة اختيارية" })
  create(
    @CurrentUser() actor: PublicUser,
    @Body() body: CreateVehicleDto,
    @UploadedFiles()
    files?: { vehicleImage?: Express.Multer.File[]; vehicleDocument?: Express.Multer.File[] },
  ) {
    const image = files?.vehicleImage?.[0];
    if (!image) {
      return this.call(async () => {
        throw new FleetError("IMAGE_REQUIRED");
      });
    }
    return this.call(() =>
      this.fleet.createVehicle(actor.id, {
        ...body,
        image,
        document: files?.vehicleDocument?.[0],
      }),
    );
  }

  @Post(":id/approval")
  @RequirePermissions("VEHICLES_REVIEW")
  @ApiOperation({ summary: "تغيير اعتماد المركبة. الاعتماد بلا سبب ويتطلب صورة، والإلغاء يتطلب سببًا." })
  approve(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: ApprovalDto) {
    return this.call(() => this.fleet.setVehicleApproval(actor.id, id, body.status, body.reason));
  }

  @Post(":id/assign")
  @RequirePermissions("VEHICLES_REVIEW")
  @ApiOperation({ summary: "إسناد المركبة إلى سائق" })
  assign(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: AssignVehicleDto) {
    return this.call(() => this.fleet.assignVehicle(actor.id, id, body.driverProfileId, body.isPrimary ?? true));
  }

  @Post(":id/documents")
  @RequirePermissions("VEHICLES_REVIEW")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "تسجيل بيانات وثيقة مركبة. لا يُرفع ملف في هذه المرحلة." })
  addDocument(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: CreateDocumentDto) {
    return this.call(() => this.fleet.addVehicleDocument(actor.id, id, body.kind, body.expiresOn));
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throwFleetHttp(error);
    }
  }
}

@ApiTags("vehicles")
@ApiBearerAuth()
@Controller("vehicle-documents")
export class VehicleDocumentsController {
  constructor(private readonly fleet: FleetService) {}

  @Post(":id/review")
  @RequirePermissions("VEHICLES_REVIEW")
  @ApiOperation({ summary: "مراجعة وثيقة مركبة" })
  review(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: ReviewDocumentDto) {
    return this.call(() => this.fleet.reviewVehicleDocument(actor.id, id, body.status));
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throwFleetHttp(error);
    }
  }
}

@ApiTags("service-areas")
@ApiBearerAuth()
@Controller("service-areas")
export class ServiceAreasController {
  constructor(private readonly fleet: FleetService) {}

  @Get()
  @RequirePermissions("SERVICE_AREAS_MANAGE")
  @ApiOperation({ summary: "مناطق الخدمة وطلبات الربط المعلقة" })
  list() {
    return this.fleet.listAreas();
  }

  @Post()
  @RequirePermissions("SERVICE_AREAS_MANAGE")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "إنشاء منطقة خدمة. المضلع لا يُستخدم للمطابقة بعد." })
  create(@CurrentUser() actor: PublicUser, @Body() body: CreateServiceAreaDto) {
    return this.call(() => this.fleet.createArea(actor.id, body));
  }

  @Patch(":id")
  @RequirePermissions("SERVICE_AREAS_MANAGE")
  @ApiOperation({ summary: "تفعيل منطقة أو إيقافها" })
  update(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: UpdateServiceAreaDto) {
    return this.call(() => this.fleet.setAreaActive(actor.id, id, body.isActive));
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throwFleetHttp(error);
    }
  }
}

@ApiTags("service-areas")
@ApiBearerAuth()
@Controller("driver-service-areas")
export class DriverServiceAreasController {
  constructor(private readonly fleet: FleetService) {}

  @Post(":id/review")
  @RequirePermissions("SERVICE_AREAS_MANAGE")
  @ApiOperation({ summary: "اعتماد ربط السائق بمنطقة أو رفضه" })
  review(
    @CurrentUser() actor: PublicUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: ReviewServiceAreaLinkDto,
  ) {
    return this.call(() => this.fleet.reviewAreaLink(actor.id, id, body.status));
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throwFleetHttp(error);
    }
  }
}

@ApiTags("dispatch")
@ApiBearerAuth()
@Controller("dispatch")
export class DispatchPreviewController {
  constructor(private readonly fleet: FleetService) {}

  @Post("offer-preview")
  @RequirePermissions("TRIPS_DISPATCH")
  @ApiOperation({
    summary: "معاينة مطابقة سائق لطلب. لا تنشئ عرضًا ولا إسنادًا. المسافة المستقيمة ليست زمن طريق.",
  })
  preview(@Body() body: OfferPreviewDto) {
    return this.call(() => this.fleet.previewOffer(body));
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throwFleetHttp(error);
    }
  }
}
