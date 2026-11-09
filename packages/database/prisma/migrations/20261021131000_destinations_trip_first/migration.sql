-- Destinations are platform places. Trips are created first and point at one destination.
-- A booking joins a passenger to one trip, or to an outbound trip and a return trip.

ALTER TYPE "TripDirection" ADD VALUE IF NOT EXISTS 'ROUND_TRIP';

CREATE TABLE "Destination" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "addressNote" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Destination_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Destination_isActive_name_idx" ON "Destination"("isActive", "name");

ALTER TABLE "Trip" ADD COLUMN "reference" TEXT,
ADD COLUMN "destinationId" UUID,
ADD COLUMN "direction" "TripDirection",
ADD COLUMN "scheduledAt" TIMESTAMP(3),
ADD COLUMN "notes" TEXT;

ALTER TABLE "TripPassenger" ADD COLUMN "bookingId" UUID,
ADD COLUMN "pickupLatitude" DECIMAL(9,6),
ADD COLUMN "pickupLongitude" DECIMAL(9,6),
ADD COLUMN "pickupNote" TEXT,
ADD COLUMN "fareAmount" DECIMAL(14,2),
ADD COLUMN "fareCurrency" CHAR(3),
ADD COLUMN "fareLockedAt" TIMESTAMP(3);

INSERT INTO "Destination" ("id", "name", "latitude", "longitude", "addressNote", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(),
       b."dropoffLabel",
       COALESCE(b."dropoffLatitude", 0),
       COALESCE(b."dropoffLongitude", 0),
       CASE WHEN b."dropoffLatitude" IS NULL OR b."dropoffLongitude" IS NULL THEN 'موقع سابق بلا إحداثيات' ELSE NULL END,
       true,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM "Booking" b
JOIN "Trip" t ON t."bookingId" = b.id;

UPDATE "Trip" t
SET "reference" = b."reference",
    "direction" = b."direction",
    "scheduledAt" = b."scheduledAt",
    "destinationId" = d."id"
FROM "Booking" b
JOIN "Destination" d ON d."name" = b."dropoffLabel"
WHERE t."bookingId" = b.id
  AND t."destinationId" IS NULL;

UPDATE "TripPassenger" tp
SET "bookingId" = t."bookingId",
    "pickupLatitude" = b."pickupLatitude",
    "pickupLongitude" = b."pickupLongitude",
    "pickupNote" = b."pickupLabel",
    "fareAmount" = b."fareAmount",
    "fareCurrency" = b."fareCurrency",
    "fareLockedAt" = b."fareLockedAt"
FROM "Trip" t
JOIN "Booking" b ON b.id = t."bookingId"
WHERE tp."tripId" = t.id
  AND tp."bookingId" IS NULL;

ALTER TABLE "Trip" ALTER COLUMN "reference" SET NOT NULL;
ALTER TABLE "Trip" ALTER COLUMN "destinationId" SET NOT NULL;
ALTER TABLE "Trip" ALTER COLUMN "direction" SET NOT NULL;
ALTER TABLE "Trip" ALTER COLUMN "scheduledAt" SET NOT NULL;
ALTER TABLE "TripPassenger" ALTER COLUMN "bookingId" SET NOT NULL;

CREATE UNIQUE INDEX "Trip_reference_key" ON "Trip"("reference");
CREATE INDEX "Trip_status_scheduledAt_idx" ON "Trip"("status", "scheduledAt");
CREATE INDEX "Trip_destinationId_scheduledAt_idx" ON "Trip"("destinationId", "scheduledAt");
CREATE INDEX "Trip_direction_scheduledAt_idx" ON "Trip"("direction", "scheduledAt");
DROP INDEX IF EXISTS "Trip_status_createdAt_idx";

ALTER TABLE "Trip" ADD CONSTRAINT "Trip_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "Destination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TripPassenger" ADD CONSTRAINT "TripPassenger_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "TripPassenger_bookingId_idx" ON "TripPassenger"("bookingId");

ALTER TABLE "Trip" DROP CONSTRAINT "Trip_bookingId_fkey";
DROP INDEX "Trip_bookingId_key";
ALTER TABLE "Trip" DROP COLUMN "bookingId";
