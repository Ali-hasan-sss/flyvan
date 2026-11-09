import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { readApiConfig } from "../config";
import { AccessGuard } from "./access.guard";
import { Argon2PasswordHasher } from "./argon2-password-hasher";
import { AttemptLimiter } from "./attempt-limiter";
import { AuthController } from "./auth.controller";
import { PermissionsGuard, PrismaPermissionCatalog } from "./permissions.guard";
import { PrismaSessionStore } from "./prisma-session.store";
import { SessionService } from "./session.service";

@Module({
  controllers: [AuthController],
  providers: [
    PrismaSessionStore,
    Argon2PasswordHasher,
    AttemptLimiter,
    PrismaPermissionCatalog,
    {
      provide: SessionService,
      inject: [PrismaSessionStore, Argon2PasswordHasher],
      useFactory: (store: PrismaSessionStore, passwords: Argon2PasswordHasher) => {
        const config = readApiConfig(process.env);
        return new SessionService(store, passwords, {
          accessSecret: config.accessTokenSecret,
          accessTtlSeconds: config.accessTokenTtlSeconds,
          refreshTtlSeconds: config.refreshTokenTtlSeconds,
        });
      },
    },
    AccessGuard,
    PermissionsGuard,
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [Argon2PasswordHasher, SessionService],
})
export class AuthModule {}
