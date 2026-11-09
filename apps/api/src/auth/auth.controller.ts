import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import {
  ATTEMPT_WINDOW_MS,
  AttemptLimiter,
  LOGIN_ATTEMPT_LIMIT,
  REFRESH_ATTEMPT_LIMIT,
  RateLimitError,
} from "./attempt-limiter";
import { LoginDto, RefreshDto } from "./auth.dto";
import { CurrentUser } from "./access.guard";
import { Public } from "./public.decorator";
import type { PublicUser } from "./public-user";
import { InvalidCredentialsError, SessionService } from "./session.service";
import { HttpException } from "@nestjs/common";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly sessions: SessionService,
    private readonly attempts: AttemptLimiter,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "تسجيل الدخول بالبريد أو الهاتف" })
  async login(@Body() body: LoginDto, @Req() request: Request) {
    this.guardAttempts(`login:${clientKey(request)}`, LOGIN_ATTEMPT_LIMIT);
    try {
      return await this.sessions.login(body.identifier, body.password);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw new HttpException("بيانات الدخول غير صحيحة.", HttpStatus.UNAUTHORIZED);
      }
      throw error;
    }
  }

  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "تدوير رمز التحديث وإصدار رمز دخول جديد" })
  async refresh(@Body() body: RefreshDto, @Req() request: Request) {
    this.guardAttempts(`refresh:${clientKey(request)}`, REFRESH_ATTEMPT_LIMIT);
    try {
      return await this.sessions.refresh(body.refreshToken);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw new HttpException("جلسة التحديث غير صالحة.", HttpStatus.UNAUTHORIZED);
      }
      throw error;
    }
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "إبطال رمز التحديث الحالي" })
  async logout(@Body() body: RefreshDto): Promise<void> {
    await this.sessions.logout(body.refreshToken);
  }

  @Get("me")
  @ApiBearerAuth()
  @ApiOkResponse({ description: "المستخدم صاحب رمز الدخول" })
  @ApiOperation({ summary: "قراءة الجلسة الحالية" })
  me(@CurrentUser() user: PublicUser): PublicUser {
    return user;
  }

  private guardAttempts(key: string, limit: number): void {
    try {
      this.attempts.assertAllowed(key, limit, ATTEMPT_WINDOW_MS);
    } catch (error) {
      if (error instanceof RateLimitError) {
        throw new HttpException("محاولات كثيرة. أعد المحاولة بعد قليل.", HttpStatus.TOO_MANY_REQUESTS);
      }
      throw error;
    }
  }
}

function clientKey(request: Request): string {
  return request.ip || request.socket.remoteAddress || "unknown";
}
