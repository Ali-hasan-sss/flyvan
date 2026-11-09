ALTER TABLE "Trip" ADD COLUMN "isDaily" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Trip" ADD COLUMN "arrivesAt" TIMESTAMP(3);
UPDATE "Trip" SET "arrivesAt" = "scheduledAt" + INTERVAL '60 minutes' WHERE "arrivesAt" IS NULL;
ALTER TABLE "Trip" ALTER COLUMN "arrivesAt" SET NOT NULL;

ALTER TABLE "TripPassenger" ADD COLUMN "pickupAt" TIMESTAMP(3);

CREATE TABLE "TripVehicle" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TripVehicle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TripVehicle_tripId_vehicleId_key" ON "TripVehicle"("tripId", "vehicleId");
CREATE INDEX "TripVehicle_driverProfileId_idx" ON "TripVehicle"("driverProfileId");

ALTER TABLE "TripVehicle" ADD CONSTRAINT "TripVehicle_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TripVehicle" ADD CONSTRAINT "TripVehicle_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TripVehicle" ADD CONSTRAINT "TripVehicle_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "TripVehicle" ("id", "tripId", "vehicleId", "driverProfileId", "createdAt")
SELECT gen_random_uuid(), "id", "vehicleId", "driverProfileId", CURRENT_TIMESTAMP
FROM "Trip"
WHERE "vehicleId" IS NOT NULL AND "driverProfileId" IS NOT NULL;
