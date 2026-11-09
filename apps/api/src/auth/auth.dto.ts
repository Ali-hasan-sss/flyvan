import { ApiProperty } from "@nestjs/swagger";
import { IsString, MaxLength, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty({ example: "owner@localhost.test" })
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  identifier!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(500)
  refreshToken!: string;
}
