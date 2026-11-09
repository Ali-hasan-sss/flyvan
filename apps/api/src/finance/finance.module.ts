import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FinanceController, TripCreditController } from "./finance.controller";
import { FinanceService } from "./finance.service";

@Module({
  imports: [AuthModule],
  controllers: [FinanceController, TripCreditController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
