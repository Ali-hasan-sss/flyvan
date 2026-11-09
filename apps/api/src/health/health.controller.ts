import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { Public } from "../auth/public.decorator";
import { healthHttpStatus } from "./health-status";
import { HealthService } from "./health.service";

@ApiTags("health")
@Public()
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: "فحص صحة الخدمة والاتصال بقاعدة البيانات" })
  async getHealth(@Res({ passthrough: true }) response: Response) {
    const report = await this.healthService.check();
    response.status(healthHttpStatus(report) === 200 ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}
