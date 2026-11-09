import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

const COVERAGE = ["OUTBOUND", "RETURN", "ROUND_TRIP"] as const;
const TRIP_DIRECTIONS = ["OUTBOUND", "RETURN"] as const;
const TRIP_TARGETS = ["DRIVER_ARRIVED", "IN_PROGRESS", "COMPLETED", "NO_SHOW", "CANCELLED", "DISPUTED"] as const;
const BOARDING = ["BOARDED", "NO_SHOW", "CANCELLED"] as const;

export class ListOperationsQueryDto {
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

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(typeof value === "string" ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ enum: ["scheduledAt", "createdAt", "reference", "status"] })
  @IsOptional()
  @IsString()
  @IsIn(["scheduledAt", "createdAt", "reference", "status"])
  sort?: "scheduledAt" | "createdAt" | "reference" | "status";

  @ApiPropertyOptional({ enum: ["asc", "desc"], default: "desc" })
  @IsOptional()
  @IsIn(["asc", "desc"])
  direction?: "asc" | "desc";

  @ApiPropertyOptional({ enum: TRIP_DIRECTIONS })
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsIn(TRIP_DIRECTIONS)
  leg?: (typeof TRIP_DIRECTIONS)[number];

  @ApiPropertyOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsOptional()
  @IsBoolean()
  bookable?: boolean;

  @ApiPropertyOptional({ description: "عند الإدارة: الرحلات المسندة لهذا السائق، السابقة والتالية." })
  @Transform(({ value }) => emptyToUndefined(typeof value === "string" ? value.trim() : value))
  @IsOptional()
  @IsUUID()
  driverId?: string;
}

export class DriverMapQueryDto {
  @ApiProperty({ example: "33.513800" })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  latitude!: string;

  @ApiProperty({ example: "36.276500" })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  longitude!: string;
}

export class CreateBookingDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  passengerName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  passengerPhone!: string;

  @ApiProperty({ enum: COVERAGE })
  @IsString()
  @IsIn(COVERAGE)
  direction!: (typeof COVERAGE)[number];

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsUUID()
  tripId?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsUUID()
  outboundTripId?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsUUID()
  returnTripId?: string;

  @ApiProperty({ description: "خط عرض نقطة الالتقاط من الخريطة" })
  @IsString()
  @MaxLength(20)
  pickupLatitude!: string;

  @ApiProperty({ description: "خط طول نقطة الالتقاط من الخريطة" })
  @IsString()
  @MaxLength(20)
  pickupLongitude!: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  @MaxLength(160)
  pickupNote?: string;

  @ApiProperty({ example: "25.00" })
  @IsString()
  @MaxLength(16)
  fareAmount!: string;

  @ApiPropertyOptional({ description: "أجرة رحلة الإياب عند اختيار ذهاب وإياب" })
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  @MaxLength(16)
  returnFareAmount?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateTripDto {
  @ApiProperty({ enum: TRIP_DIRECTIONS })
  @IsString()
  @IsIn(TRIP_DIRECTIONS)
  direction!: (typeof TRIP_DIRECTIONS)[number];

  @ApiProperty()
  @IsUUID()
  destinationId!: string;

  @ApiProperty()
  @IsString()
  scheduledAt!: string;

  @ApiProperty()
  @IsString()
  arrivesAt!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isDaily?: boolean;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpsertDestinationDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(20)
  latitude!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(20)
  longitude!: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  @MaxLength(160)
  addressNote?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AdjustFareDto {
  @ApiProperty()
  @IsUUID()
  tripId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(16)
  fareAmount!: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class CompanyFareDto {
  @ApiProperty()
  @IsBoolean()
  paid!: boolean;
}

export class CancelBookingDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class SetTripOriginDto {
  @ApiProperty()
  @IsString()
  @MaxLength(20)
  latitude!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(20)
  longitude!: string;
}

export class AssignTripDto {
  @ApiProperty()
  @IsUUID()
  driverProfileId!: string;
}

export class OfferTripDto {
  @ApiProperty()
  @IsUUID()
  driverProfileId!: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => (value === undefined || value === "" ? undefined : Number(value)))
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500_000)
  straightLineMeters?: number;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsUUID()
  serviceAreaId?: string;
}

export class TripStatusDto {
  @ApiProperty({ enum: TRIP_TARGETS })
  @IsString()
  @IsIn(TRIP_TARGETS)
  status!: (typeof TRIP_TARGETS)[number];

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  occurredAt?: string;

  @ApiPropertyOptional({ description: "موقع السائق عند إنهاء الرحلة داخل دائرة الوجهة." })
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  @MaxLength(40)
  latitude?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  @MaxLength(40)
  longitude?: string;
}

export class RespondOfferDto {
  @ApiProperty({ enum: ["ACCEPT", "REJECT"] })
  @IsString()
  @IsIn(["ACCEPT", "REJECT"])
  decision!: "ACCEPT" | "REJECT";
}

export class ExpandLocationDto {
  @ApiProperty({ description: "نص رسالة الموقع أو رابط خرائط مختصر" })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(8)
  @MaxLength(2000)
  value!: string;
}

export class PreviewRunDto {
  @ApiProperty()
  @IsUUID()
  vehicleId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(20)
  latitude!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(20)
  longitude!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(40)
  scheduledAt!: string;
}

export class ConfirmRunDto extends PreviewRunDto {
  @ApiProperty()
  @IsString()
  @MaxLength(40)
  arrivesAt!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @IsUUID("4", { each: true })
  passengerIds!: string[];
}

export class ReportBreakdownDto {
  @ApiPropertyOptional({ description: "وصف العطل أو الحادث. إن تُرك يُسجَّل كعطل أو حادث." })
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class BoardingDto {
  @ApiProperty({ enum: BOARDING })
  @IsString()
  @IsIn(BOARDING)
  status!: (typeof BOARDING)[number];

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(4)
  code?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  occurredAt?: string;
}

export class PublicBookingDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  passengerName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  passengerPhone!: string;

  @ApiProperty()
  @IsUUID()
  tripId!: string;

  @ApiProperty({ minimum: 1, maximum: 6 })
  @IsInt()
  @Min(1)
  @Max(6)
  seatCount!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(20)
  pickupLatitude!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(20)
  pickupLongitude!: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => emptyToUndefined(value))
  @IsOptional()
  @IsString()
  @MaxLength(160)
  pickupNote?: string;
}

export class ConfirmBookingDto {
  @ApiProperty()
  @IsString()
  @MaxLength(20)
  fareAmount!: string;
}
