import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

function trimmed(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

export class RateChangeDto {
  @ApiProperty({ example: "10.000" })
  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(1)
  @MaxLength(7)
  ratePercent!: string;

  @ApiProperty()
  @IsISO8601()
  effectiveFrom!: string;

  @ApiProperty()
  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class CreditLimitDto {
  @ApiProperty({ example: "500.00" })
  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  amount!: string;

  @ApiProperty()
  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class RecordSettlementDto {
  @ApiProperty()
  @IsUUID()
  driverProfileId!: string;

  @ApiProperty({ example: "25.00" })
  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(1)
  @MaxLength(16)
  amount!: string;

  @ApiProperty({ example: "CASH" })
  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  method!: string;

  @ApiProperty()
  @IsISO8601()
  receivedAt!: string;

  @ApiProperty()
  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  receiptNumber!: string;

  @ApiProperty()
  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(8)
  @MaxLength(80)
  idempotencyKey!: string;
}

export class ReviewSettlementDto {
  @ApiProperty({ enum: ["PENDING_REVIEW", "REJECTED"] })
  @IsIn(["PENDING_REVIEW", "REJECTED"])
  decision!: "PENDING_REVIEW" | "REJECTED";

  @ApiPropertyOptional()
  @Transform(({ value }) => trimmed(value))
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class CreditExceptionDto {
  @ApiProperty()
  @Transform(({ value }) => trimmed(value))
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}
