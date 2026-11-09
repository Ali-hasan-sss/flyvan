import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../auth/access.guard";
import { RequirePermissions } from "../auth/permissions.decorator";
import type { PublicUser } from "../auth/public-user";
import { CreditExceptionDto, CreditLimitDto, RateChangeDto, RecordSettlementDto, ReviewSettlementDto } from "./finance.dto";
import { throwFinanceHttp } from "./finance.errors";
import { FinanceService } from "./finance.service";

@ApiTags("finance")
@ApiBearerAuth()
@Controller("finance")
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get("summary")
  @RequirePermissions("FINANCE_VIEW")
  @ApiOperation({ summary: "أرصدة السائقين والتسويات. الإجمالي التجميعي لا يوقف السائقين." })
  summary(@CurrentUser() actor: PublicUser) {
    return this.call(() => this.finance.summary(actor));
  }

  @Get("me")
  @RequirePermissions("OWN_FINANCE_VIEW")
  @ApiOperation({ summary: "عمولات السائق الحالي وتسديداته. أجرة الراكب النقدية ليست منها." })
  me(@CurrentUser() actor: PublicUser) {
    return this.call(() => this.finance.ownSummary(actor));
  }

  @Post("policy")
  @RequirePermissions("COMMISSION_POLICY_MANAGE")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "سياسة عمولة افتراضية جديدة. لا تعيد كتابة عمولات الرحلات السابقة." })
  policy(@CurrentUser() actor: PublicUser, @Body() body: RateChangeDto) {
    return this.call(() => this.finance.setPolicy(actor, body));
  }

  @Post("drivers/:id/commission")
  @RequirePermissions("DRIVER_COMMISSION_MANAGE")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "نسبة عمولة خاصة بسائق مع تاريخ سريان. النسبة السابقة تُغلق ولا تُمسح." })
  driverRate(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: RateChangeDto) {
    return this.call(() => this.finance.setDriverRate(actor, id, body));
  }

  @Post("drivers/:id/credit-limit")
  @RequirePermissions("CREDIT_LIMIT_MANAGE")
  @ApiOperation({ summary: "تعيين حد مديونية السائق لعملة الليرة السورية مع سبب وتدقيق." })
  creditLimit(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: CreditLimitDto) {
    return this.call(() => this.finance.setCreditLimit(actor, id, body));
  }

  @Post("settlements")
  @RequirePermissions("FINANCE_RECORD_PAYMENT")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "تسجيل دفعة استلمها الموظف. لا تدخل الدفتر قبل اعتماد مالك المنصة." })
  record(@CurrentUser() actor: PublicUser, @Body() body: RecordSettlementDto) {
    return this.call(() => this.finance.recordSettlement(actor, body));
  }

  @Post("settlements/:id/review")
  @RequirePermissions("FINANCE_REVIEW_SETTLEMENT")
  @ApiOperation({ summary: "مراجعة الدفعة أو رفضها. الرفض لا ينشئ قيدًا." })
  review(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: ReviewSettlementDto) {
    return this.call(() => this.finance.reviewSettlement(actor, id, body.decision, body.note));
  }

  @Post("settlements/:id/approve")
  @RequirePermissions("FINANCE_APPROVE_SETTLEMENT")
  @ApiOperation({ summary: "اعتماد الدفعة وتوزيعها على أقدم العمولات غير المسددة. الزيادة تبقى رصيدًا دائنًا." })
  approve(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.call(() => this.finance.approveSettlement(actor, id));
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throwFinanceHttp(error);
    }
  }
}

@ApiTags("trips")
@ApiBearerAuth()
@Controller("trips")
export class TripCreditController {
  constructor(private readonly finance: FinanceService) {}

  @Post(":id/credit-exception")
  @RequirePermissions("CREDIT_EXCEPTION_GRANT")
  @ApiOperation({ summary: "استثناء موثق لتجاوز حد هذا السائق على هذه الرحلة فقط." })
  grant(@CurrentUser() actor: PublicUser, @Param("id", ParseUUIDPipe) id: string, @Body() body: CreditExceptionDto) {
    return this.call(() => this.finance.grantCreditException(actor, id, body.reason));
  }

  private async call<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throwFinanceHttp(error);
    }
  }
}
