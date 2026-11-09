import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { buildHealthReport, readDatabaseStatus, type HealthReport } from "./health-status";

export type { HealthReport } from "./health-status";

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<HealthReport> {
    const database = await readDatabaseStatus(() => this.prisma.client.$queryRaw`SELECT 1`);
    return buildHealthReport(database);
  }
}
