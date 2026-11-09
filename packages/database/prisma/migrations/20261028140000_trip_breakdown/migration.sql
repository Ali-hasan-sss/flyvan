ALTER TABLE "Trip" ADD COLUMN "breakdownReportedAt" TIMESTAMP(3);
ALTER TABLE "Trip" ADD COLUMN "breakdownNote" TEXT;

CREATE INDEX "Trip_breakdownReportedAt_idx" ON "Trip"("breakdownReportedAt");
