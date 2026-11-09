import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { USER_ROLES } from "@flyvan/types";
import { Transform } from "class-transformer";
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

function emptyToUndefined(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export class ListUsersQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Transform(({ value }) => (value === undefined || value === "" ? 1 : Number(value)))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20 })
  @Transform(({ value }) => (value === undefined || value === "" ? 20 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class CreateUserDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName!: string;

  @ApiProperty({ enum: USER_ROLES })
  @IsString()
  @IsIn(USER_ROLES)
  role!: string;

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

  @ApiProperty()
  @IsString()
  @MinLength(6, { message: "رقم الهاتف مطلوب." })
  @MaxLength(20)
  phone!: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName?: string;

  @ApiPropertyOptional({ enum: USER_ROLES })
  @IsOptional()
  @IsString()
  @IsIn(USER_ROLES)
  role?: string;

  @ApiPropertyOptional({ minLength: 8 })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل." })
  @MaxLength(200, { message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل." })
  password?: string;
}

export class DisableUserDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
