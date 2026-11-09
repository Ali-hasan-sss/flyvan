import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./auth/auth.module";
import { FinanceModule } from "./finance/finance.module";
import { FleetModule } from "./fleet/fleet.module";
import { HealthModule } from "./health/health.module";
import { OperationsModule } from "./operations/operations.module";
import { PrismaModule } from "./prisma/prisma.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    FleetModule,
    FinanceModule,
    OperationsModule,
    HealthModule,
  ],
})
export class AppModule {}
