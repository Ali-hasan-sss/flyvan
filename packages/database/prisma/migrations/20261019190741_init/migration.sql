-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PLATFORM_OWNER', 'ADMIN', 'DISPATCHER', 'FINANCE', 'DRIVER', 'PASSENGER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('USERS_MANAGE', 'PLATFORM_SETTINGS_MANAGE', 'DRIVERS_REVIEW', 'VEHICLES_REVIEW', 'COMMISSION_POLICY_MANAGE', 'DRIVER_COMMISSION_MANAGE', 'CREDIT_LIMIT_MANAGE', 'CREDIT_EXCEPTION_GRANT', 'BOOKINGS_MANAGE', 'FARE_LOCK', 'FARE_ADJUST', 'TRIPS_DISPATCH', 'TRIPS_VIEW_ALL', 'TRIPS_OPERATE_OWN', 'FINANCE_VIEW', 'FINANCE_RECORD_PAYMENT', 'FINANCE_REVIEW_SETTLEMENT', 'FINANCE_APPROVE_SETTLEMENT', 'REPORTS_VIEW', 'AUDIT_VIEW', 'SERVICE_AREAS_MANAGE', 'OWN_PROFILE_VIEW', 'OWN_SERVICE_AREAS_MANAGE', 'OWN_FINANCE_VIEW', 'OWN_BOOKINGS_VIEW');

-- CreateEnum
CREATE TYPE "DriverApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "VehicleApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentOwnerType" AS ENUM ('DRIVER', 'VEHICLE');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ServiceAreaKind" AS ENUM ('CITY', 'DISTRICT', 'GEOFENCE');

-- CreateEnum
CREATE TYPE "ServiceAreaPreference" AS ENUM ('TARGET', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "DriverServiceAreaStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ENDED');

-- CreateEnum
CREATE TYPE "TripDirection" AS ENUM ('OUTBOUND', 'RETURN', 'INDEPENDENT');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('DRAFT', 'PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PENDING_ASSIGNMENT', 'OFFERED', 'ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "OfferSource" AS ENUM ('NEARBY', 'SERVICE_AREA', 'MANUAL_DISPATCH', 'MATCHING_ENGINE');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BoardingStatus" AS ENUM ('EXPECTED', 'BOARDED', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('DRIVER_APP', 'CONTROL', 'PASSENGER_CODE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TripEventType" AS ENUM ('STATUS_CHANGED', 'ASSIGNMENT_CHANGED', 'BOARDING_RECORDED', 'PASSENGER_FARE_COLLECTED', 'NOTE');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'DUE', 'PARTIALLY_PAID', 'PAID', 'REVERSED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('RECORDED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('COMMISSION_ACCRUAL', 'DRIVER_PAYMENT', 'CREDIT_ADJUSTMENT', 'DEBIT_ADJUSTMENT', 'REVERSAL');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "disabledReason" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "role" "UserRole" NOT NULL,
    "permission" "Permission" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("role","permission")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "DriverProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "approvalStatus" "DriverApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "nearbyRadiusMeters" INTEGER NOT NULL DEFAULT 3000,
    "acceptsNearbyRequests" BOOLEAN NOT NULL DEFAULT true,
    "assignmentBlocked" BOOLEAN NOT NULL DEFAULT false,
    "assignmentBlockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverCommissionOverride" (
    "id" UUID NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "ratePercent" DECIMAL(6,3) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverCommissionOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionPolicy" (
    "id" UUID NOT NULL,
    "ratePercent" DECIMAL(6,3) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "reason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "approvalStatus" "VehicleApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverVehicleAssignment" (
    "id" UUID NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "activeFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverVehicleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceDocument" (
    "id" UUID NOT NULL,
    "ownerType" "DocumentOwnerType" NOT NULL,
    "driverProfileId" UUID,
    "vehicleId" UUID,
    "kind" TEXT NOT NULL,
    "expiresOn" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceArea" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ServiceAreaKind" NOT NULL,
    "parentId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "centerLatitude" DECIMAL(9,6),
    "centerLongitude" DECIMAL(9,6),
    "boundary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverServiceArea" (
    "id" UUID NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "serviceAreaId" UUID NOT NULL,
    "preference" "ServiceAreaPreference" NOT NULL DEFAULT 'TARGET',
    "status" "DriverServiceAreaStatus" NOT NULL DEFAULT 'PENDING',
    "startsOn" DATE,
    "endsOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverServiceArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PassengerContact" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PassengerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Institution" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "passengerContactId" UUID NOT NULL,
    "institutionId" UUID,
    "direction" "TripDirection" NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'DRAFT',
    "pickupLabel" TEXT NOT NULL,
    "pickupLatitude" DECIMAL(9,6),
    "pickupLongitude" DECIMAL(9,6),
    "dropoffLabel" TEXT NOT NULL,
    "dropoffLatitude" DECIMAL(9,6),
    "dropoffLongitude" DECIMAL(9,6),
    "serviceAreaId" UUID,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "fareAmount" DECIMAL(14,2),
    "fareCurrency" CHAR(3),
    "fareLockedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "updatedById" UUID,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'PENDING_ASSIGNMENT',
    "driverProfileId" UUID,
    "vehicleId" UUID,
    "assignmentSource" "OfferSource",
    "assignedAt" TIMESTAMP(3),
    "driverArrivedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "passengerFareCollectedAt" TIMESTAMP(3),
    "passengerFareCollectedById" UUID,
    "creditExceptionReason" TEXT,
    "creditExceptionById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripOffer" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "source" "OfferSource" NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "matchReason" TEXT NOT NULL,
    "straightLineMeters" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripPassenger" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "passengerContactId" UUID NOT NULL,
    "boardingStatus" "BoardingStatus" NOT NULL DEFAULT 'EXPECTED',
    "verificationCodeHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripPassenger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoardingEvent" (
    "id" UUID NOT NULL,
    "tripPassengerId" UUID NOT NULL,
    "status" "BoardingStatus" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "EventSource" NOT NULL,
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripEvent" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "type" "TripEventType" NOT NULL,
    "source" "EventSource" NOT NULL,
    "actorId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripCommission" (
    "id" UUID NOT NULL,
    "tripId" UUID NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "fareAmount" DECIMAL(14,2) NOT NULL,
    "commissionRateApplied" DECIMAL(6,3) NOT NULL,
    "commissionAmount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'DUE',
    "accruedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripCommission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverFinancialAccount" (
    "id" UUID NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "creditLimitAmount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverFinancialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "tripCommissionId" UUID,
    "settlementId" UUID,
    "reversesEntryId" UUID,
    "reason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" UUID NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "receivedById" UUID NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'RECORDED',
    "reviewNote" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementAllocation" (
    "id" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "tripCommissionId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_replacedById_key" ON "RefreshToken"("replacedById");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_expiresAt_idx" ON "RefreshToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DriverProfile_userId_key" ON "DriverProfile"("userId");

-- CreateIndex
CREATE INDEX "DriverCommissionOverride_driverProfileId_effectiveFrom_idx" ON "DriverCommissionOverride"("driverProfileId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "CommissionPolicy_effectiveFrom_idx" ON "CommissionPolicy"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_plateNumber_key" ON "Vehicle"("plateNumber");

-- CreateIndex
CREATE INDEX "DriverVehicleAssignment_driverProfileId_activeTo_idx" ON "DriverVehicleAssignment"("driverProfileId", "activeTo");

-- CreateIndex
CREATE INDEX "DriverVehicleAssignment_vehicleId_activeTo_idx" ON "DriverVehicleAssignment"("vehicleId", "activeTo");

-- CreateIndex
CREATE INDEX "ComplianceDocument_driverProfileId_idx" ON "ComplianceDocument"("driverProfileId");

-- CreateIndex
CREATE INDEX "ComplianceDocument_vehicleId_idx" ON "ComplianceDocument"("vehicleId");

-- CreateIndex
CREATE INDEX "ComplianceDocument_status_expiresOn_idx" ON "ComplianceDocument"("status", "expiresOn");

-- CreateIndex
CREATE INDEX "ServiceArea_kind_isActive_idx" ON "ServiceArea"("kind", "isActive");

-- CreateIndex
CREATE INDEX "DriverServiceArea_driverProfileId_status_idx" ON "DriverServiceArea"("driverProfileId", "status");

-- CreateIndex
CREATE INDEX "DriverServiceArea_serviceAreaId_status_idx" ON "DriverServiceArea"("serviceAreaId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PassengerContact_userId_key" ON "PassengerContact"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PassengerContact_phone_key" ON "PassengerContact"("phone");

-- CreateIndex
CREATE INDEX "Institution_name_idx" ON "Institution"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_reference_key" ON "Booking"("reference");

-- CreateIndex
CREATE INDEX "Booking_status_scheduledAt_idx" ON "Booking"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Booking_passengerContactId_idx" ON "Booking"("passengerContactId");

-- CreateIndex
CREATE INDEX "Booking_direction_scheduledAt_idx" ON "Booking"("direction", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_bookingId_key" ON "Trip"("bookingId");

-- CreateIndex
CREATE INDEX "Trip_status_createdAt_idx" ON "Trip"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Trip_driverProfileId_status_idx" ON "Trip"("driverProfileId", "status");

-- CreateIndex
CREATE INDEX "TripOffer_driverProfileId_status_idx" ON "TripOffer"("driverProfileId", "status");

-- CreateIndex
CREATE INDEX "TripOffer_tripId_status_idx" ON "TripOffer"("tripId", "status");

-- CreateIndex
CREATE INDEX "TripPassenger_tripId_boardingStatus_idx" ON "TripPassenger"("tripId", "boardingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "TripPassenger_tripId_passengerContactId_key" ON "TripPassenger"("tripId", "passengerContactId");

-- CreateIndex
CREATE INDEX "BoardingEvent_tripPassengerId_recordedAt_idx" ON "BoardingEvent"("tripPassengerId", "recordedAt");

-- CreateIndex
CREATE INDEX "TripEvent_tripId_recordedAt_idx" ON "TripEvent"("tripId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TripCommission_tripId_key" ON "TripCommission"("tripId");

-- CreateIndex
CREATE INDEX "TripCommission_driverProfileId_status_accruedAt_idx" ON "TripCommission"("driverProfileId", "status", "accruedAt");

-- CreateIndex
CREATE INDEX "TripCommission_currency_status_idx" ON "TripCommission"("currency", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DriverFinancialAccount_driverProfileId_currency_key" ON "DriverFinancialAccount"("driverProfileId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_tripCommissionId_key" ON "LedgerEntry"("tripCommissionId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_reversesEntryId_key" ON "LedgerEntry"("reversesEntryId");

-- CreateIndex
CREATE INDEX "LedgerEntry_driverProfileId_currency_createdAt_idx" ON "LedgerEntry"("driverProfileId", "currency", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_type_createdAt_idx" ON "LedgerEntry"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_receiptNumber_key" ON "Settlement"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_idempotencyKey_key" ON "Settlement"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Settlement_driverProfileId_status_receivedAt_idx" ON "Settlement"("driverProfileId", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "Settlement_currency_status_idx" ON "Settlement"("currency", "status");

-- CreateIndex
CREATE INDEX "SettlementAllocation_tripCommissionId_idx" ON "SettlementAllocation"("tripCommissionId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementAllocation_settlementId_tripCommissionId_key" ON "SettlementAllocation"("settlementId", "tripCommissionId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformSetting" ADD CONSTRAINT "PlatformSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverCommissionOverride" ADD CONSTRAINT "DriverCommissionOverride_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverCommissionOverride" ADD CONSTRAINT "DriverCommissionOverride_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionPolicy" ADD CONSTRAINT "CommissionPolicy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverVehicleAssignment" ADD CONSTRAINT "DriverVehicleAssignment_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverVehicleAssignment" ADD CONSTRAINT "DriverVehicleAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceArea" ADD CONSTRAINT "ServiceArea_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ServiceArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverServiceArea" ADD CONSTRAINT "DriverServiceArea_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverServiceArea" ADD CONSTRAINT "DriverServiceArea_serviceAreaId_fkey" FOREIGN KEY ("serviceAreaId") REFERENCES "ServiceArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PassengerContact" ADD CONSTRAINT "PassengerContact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_passengerContactId_fkey" FOREIGN KEY ("passengerContactId") REFERENCES "PassengerContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_serviceAreaId_fkey" FOREIGN KEY ("serviceAreaId") REFERENCES "ServiceArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_passengerFareCollectedById_fkey" FOREIGN KEY ("passengerFareCollectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_creditExceptionById_fkey" FOREIGN KEY ("creditExceptionById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripOffer" ADD CONSTRAINT "TripOffer_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripOffer" ADD CONSTRAINT "TripOffer_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPassenger" ADD CONSTRAINT "TripPassenger_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPassenger" ADD CONSTRAINT "TripPassenger_passengerContactId_fkey" FOREIGN KEY ("passengerContactId") REFERENCES "PassengerContact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardingEvent" ADD CONSTRAINT "BoardingEvent_tripPassengerId_fkey" FOREIGN KEY ("tripPassengerId") REFERENCES "TripPassenger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripCommission" ADD CONSTRAINT "TripCommission_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripCommission" ADD CONSTRAINT "TripCommission_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverFinancialAccount" ADD CONSTRAINT "DriverFinancialAccount_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_tripCommissionId_fkey" FOREIGN KEY ("tripCommissionId") REFERENCES "TripCommission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_reversesEntryId_fkey" FOREIGN KEY ("reversesEntryId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAllocation" ADD CONSTRAINT "SettlementAllocation_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAllocation" ADD CONSTRAINT "SettlementAllocation_tripCommissionId_fkey" FOREIGN KEY ("tripCommissionId") REFERENCES "TripCommission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
