ALTER TABLE "DriverProfile" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "DriverProfile_deletedAt_createdAt_idx" ON "DriverProfile"("deletedAt", "createdAt");

ALTER TABLE "Vehicle" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "Vehicle" ADD COLUMN "documentUrl" TEXT;
