import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

const APPROVAL = ["PENDING", "APPROVED", "SUSPENDED", "REJECTED"] as const;
const REVIEW = ["APPROVED", "REJECTED"] as const;
const AREA_KINDS = ["CITY", "DISTRICT", "GEOFENCE"] as const;
const PREFERENCES = ["TARGET", "EXCLUDED"] as const;

export class CreateDriverVehicleDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(16)
  plateNumber!: string;

  @ApiProperty({ minimum: 1, maximum: 20 })
  @IsInt()
  @Min(1)
  @Max(20)
  capacity!: number;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  vehicleType!: string;
}

export class CreateDriverDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(6, { message: "رقم الهاتف مطلوب." })
  @MaxLength(20)
  phone!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل." })
  @MaxLength(200, { message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل." })
  password!: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ type: CreateDriverVehicleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateDriverVehicleDto)
  vehicle?: CreateDriverVehicleDto;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  plateNumber?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => (value === undefined || value === "" ? undefined : Number(value)))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  capacity?: number;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  vehicleType?: string;
}

export class UpdateDriverDto {
  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => (value === undefined ? undefined : typeof value === "string" ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MinLength(6, { message: "رقم الهاتف مطلوب." })
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.trim() === "") return null;
    return value.trim();
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsEmail({}, { message: "البريد غير صالح." })
  email?: string | null;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsOptional()
  @IsBoolean()
  clearPhoto?: boolean;
}

export class ChangeDriverPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(8, { message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل." })
  @MaxLength(200)
  password!: string;
}

export class ApprovalDto {
  @ApiProperty({ enum: APPROVAL })
  @IsString()
  @IsIn(APPROVAL)
  status!: (typeof APPROVAL)[number];

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @ValidateIf((body: ApprovalDto) => body.status !== "APPROVED")
  @IsString({ message: "سبب إلغاء الاعتماد يجب أن يكون 3 أحرف على الأقل." })
  @MinLength(3, { message: "سبب إلغاء الاعتماد يجب أن يكون 3 أحرف على الأقل." })
  @MaxLength(300)
  reason?: string;
}

const DRIVER_SORTS = ["name", "createdAt", "activity"] as const;
const SORT_DIRECTIONS = ["asc", "desc"] as const;

export class ListDriversQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Transform(({ value }) => (value === undefined || value === "" ? 1 : Number(value)))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 10, maximum: 100 })
  @Transform(({ value }) => (value === undefined || value === "" ? 10 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 10;

  @ApiPropertyOptional({ enum: DRIVER_SORTS, default: "createdAt" })
  @IsOptional()
  @IsString()
  @IsIn(DRIVER_SORTS)
  sort: (typeof DRIVER_SORTS)[number] = "createdAt";

  @ApiPropertyOptional({ enum: SORT_DIRECTIONS, default: "desc" })
  @IsOptional()
  @IsString()
  @IsIn(SORT_DIRECTIONS)
  direction: (typeof SORT_DIRECTIONS)[number] = "desc";

  @ApiPropertyOptional({ default: false })
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  deleted = false;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(typeof value === "string" ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

const VEHICLE_SORTS = ["plate", "createdAt", "activity"] as const;

export class ListVehiclesQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Transform(({ value }) => (value === undefined || value === "" ? 1 : Number(value)))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 10, maximum: 100 })
  @Transform(({ value }) => (value === undefined || value === "" ? 10 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 10;

  @ApiPropertyOptional({ enum: VEHICLE_SORTS, default: "createdAt" })
  @IsOptional()
  @IsString()
  @IsIn(VEHICLE_SORTS)
  sort: (typeof VEHICLE_SORTS)[number] = "createdAt";

  @ApiPropertyOptional({ enum: SORT_DIRECTIONS, default: "desc" })
  @IsOptional()
  @IsString()
  @IsIn(SORT_DIRECTIONS)
  direction: (typeof SORT_DIRECTIONS)[number] = "desc";

  @ApiPropertyOptional({ default: false })
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  deleted = false;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(typeof value === "string" ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class AssignmentHoldDto {
  @ApiProperty()
  @IsBoolean()
  blocked!: boolean;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class UpdateDriverPreferencesDto {
  @ApiPropertyOptional({ minimum: 500, maximum: 50000 })
  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(50000)
  nearbyRadiusMeters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  acceptsNearbyRequests?: boolean;
}

export class CreateDocumentDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  kind!: string;

  @ApiPropertyOptional({ example: "2027-01-31" })
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expiresOn?: string;
}

export class ReviewDocumentDto {
  @ApiProperty({ enum: REVIEW })
  @IsString()
  @IsIn(REVIEW)
  status!: (typeof REVIEW)[number];
}

export class CreateVehicleDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(16)
  plateNumber!: string;

  @ApiProperty({ minimum: 1, maximum: 20 })
  @Transform(({ value }) => (value === undefined || value === "" ? value : Number(value)))
  @IsInt()
  @Min(1)
  @Max(20)
  capacity!: number;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  vehicleType!: string;
}

export class UpdateVehicleDto {
  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(16)
  plateNumber?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 20 })
  @Transform(({ value }) => (value === undefined || value === "" ? undefined : Number(value)))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  capacity?: number;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  vehicleType?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsOptional()
  @IsBoolean()
  clearDocument?: boolean;
}

export class AssignVehicleDto {
  @ApiProperty()
  @IsUUID()
  driverProfileId!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class CreateServiceAreaDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: AREA_KINDS })
  @IsString()
  @IsIn(AREA_KINDS)
  kind!: (typeof AREA_KINDS)[number];

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  centerLatitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  centerLongitude?: number;
}

export class UpdateServiceAreaDto {
  @ApiProperty()
  @IsBoolean()
  isActive!: boolean;
}

export class RequestServiceAreaDto {
  @ApiProperty()
  @IsUUID()
  serviceAreaId!: string;

  @ApiProperty({ enum: PREFERENCES })
  @IsString()
  @IsIn(PREFERENCES)
  preference!: (typeof PREFERENCES)[number];
}

export class ReviewServiceAreaLinkDto {
  @ApiProperty({ enum: REVIEW })
  @IsString()
  @IsIn(REVIEW)
  status!: (typeof REVIEW)[number];
}

export class OfferPreviewDto {
  @ApiProperty()
  @IsUUID()
  driverProfileId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_000_000)
  straightLineMeters?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  serviceAreaId?: string;
}
