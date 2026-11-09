-- Applied on top of the generated initial migration.
-- Amounts stay immutable. Corrections are reversing ledger entries, not deletes.

ALTER TABLE "User"
  ADD CONSTRAINT "User_email_or_phone"
  CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);

ALTER TABLE "DriverProfile"
  ADD CONSTRAINT "DriverProfile_radius_positive"
  CHECK ("nearbyRadiusMeters" > 0);

ALTER TABLE "Vehicle"
  ADD CONSTRAINT "Vehicle_capacity_positive"
  CHECK ("capacity" > 0);

ALTER TABLE "ComplianceDocument"
  ADD CONSTRAINT "ComplianceDocument_one_owner"
  CHECK (
    ("ownerType" = 'DRIVER' AND "driverProfileId" IS NOT NULL AND "vehicleId" IS NULL)
    OR ("ownerType" = 'VEHICLE' AND "vehicleId" IS NOT NULL AND "driverProfileId" IS NULL)
  );

ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_fare_pair"
  CHECK (
    ("fareAmount" IS NULL AND "fareCurrency" IS NULL)
    OR ("fareAmount" IS NOT NULL AND "fareCurrency" IS NOT NULL AND "fareAmount" >= 0)
  );

ALTER TABLE "CommissionPolicy"
  ADD CONSTRAINT "CommissionPolicy_rate_range"
  CHECK ("ratePercent" >= 0 AND "ratePercent" <= 100);

ALTER TABLE "DriverCommissionOverride"
  ADD CONSTRAINT "DriverCommissionOverride_rate_range"
  CHECK ("ratePercent" >= 0 AND "ratePercent" <= 100);

ALTER TABLE "TripCommission"
  ADD CONSTRAINT "TripCommission_amounts_nonnegative"
  CHECK ("fareAmount" >= 0 AND "commissionAmount" >= 0);

ALTER TABLE "TripCommission"
  ADD CONSTRAINT "TripCommission_rate_range"
  CHECK ("commissionRateApplied" >= 0 AND "commissionRateApplied" <= 100);

ALTER TABLE "DriverFinancialAccount"
  ADD CONSTRAINT "DriverFinancialAccount_limit_nonnegative"
  CHECK ("creditLimitAmount" >= 0);

ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_amount_positive"
  CHECK ("amount" > 0);

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_amount_positive"
  CHECK ("amount" > 0);

ALTER TABLE "SettlementAllocation"
  ADD CONSTRAINT "SettlementAllocation_amount_positive"
  CHECK ("amount" > 0);

CREATE UNIQUE INDEX "DriverServiceArea_open_preference_key"
  ON "DriverServiceArea" ("driverProfileId", "serviceAreaId", "preference")
  WHERE "status" IN ('PENDING', 'APPROVED');

CREATE FUNCTION flyvan_reject_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'append-only table % cannot be updated or deleted', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "LedgerEntry_append_only"
  BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION flyvan_reject_mutation();

CREATE TRIGGER "BoardingEvent_append_only"
  BEFORE UPDATE OR DELETE ON "BoardingEvent"
  FOR EACH ROW EXECUTE FUNCTION flyvan_reject_mutation();

CREATE TRIGGER "TripEvent_append_only"
  BEFORE UPDATE OR DELETE ON "TripEvent"
  FOR EACH ROW EXECUTE FUNCTION flyvan_reject_mutation();

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION flyvan_reject_mutation();

CREATE TRIGGER "SettlementAllocation_append_only"
  BEFORE UPDATE OR DELETE ON "SettlementAllocation"
  FOR EACH ROW EXECUTE FUNCTION flyvan_reject_mutation();

CREATE FUNCTION flyvan_guard_trip_commission() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'trip commissions cannot be deleted';
  END IF;
  IF NEW."fareAmount" IS DISTINCT FROM OLD."fareAmount"
     OR NEW."commissionRateApplied" IS DISTINCT FROM OLD."commissionRateApplied"
     OR NEW."commissionAmount" IS DISTINCT FROM OLD."commissionAmount"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."tripId" IS DISTINCT FROM OLD."tripId"
     OR NEW."driverProfileId" IS DISTINCT FROM OLD."driverProfileId"
     OR NEW."id" IS DISTINCT FROM OLD."id"
  THEN
    RAISE EXCEPTION 'commission identity and amounts are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "TripCommission_guard"
  BEFORE UPDATE OR DELETE ON "TripCommission"
  FOR EACH ROW EXECUTE FUNCTION flyvan_guard_trip_commission();

CREATE FUNCTION flyvan_guard_settlement() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'settlements cannot be deleted';
  END IF;
  IF NEW."amount" IS DISTINCT FROM OLD."amount"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."driverProfileId" IS DISTINCT FROM OLD."driverProfileId"
     OR NEW."receiptNumber" IS DISTINCT FROM OLD."receiptNumber"
     OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
     OR NEW."id" IS DISTINCT FROM OLD."id"
  THEN
    RAISE EXCEPTION 'settlement identity and amount are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Settlement_guard"
  BEFORE UPDATE OR DELETE ON "Settlement"
  FOR EACH ROW EXECUTE FUNCTION flyvan_guard_settlement();
