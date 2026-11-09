ALTER TABLE "Vehicle" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Vehicle_deletedAt_createdAt_idx" ON "Vehicle"("deletedAt", "createdAt");
