ALTER TABLE "Trip" ADD COLUMN "parentTripId" UUID;

CREATE INDEX "Trip_parentTripId_scheduledAt_idx" ON "Trip"("parentTripId", "scheduledAt");

ALTER TABLE "Trip" ADD CONSTRAINT "Trip_parentTripId_fkey" FOREIGN KEY ("parentTripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
