import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPrismaClient, type PrismaClient } from "@flyvan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicUser } from "../auth/public-user";
import { PrismaService } from "../prisma/prisma.service";
import { OperationsService } from "../operations/operations.service";
import { FinanceError } from "./finance.errors";
import { FinanceService } from "./finance.service";

function repoRoot(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  throw new Error("repo root missing");
}

function databaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;
  const root = repoRoot();
  const text = readFileSync(resolve(root, ".env"), "utf8");
  const line = text.split(/\r?\n/).find((row) => row.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL missing");
  return line.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
}

function actor(user: { id: string; email: string | null; phone: string | null; displayName: string; role: PublicUser["role"] }): PublicUser {
  return { id: user.id, email: user.email, phone: user.phone, displayName: user.displayName, role: user.role, status: "ACTIVE" };
}

describe("commission ledger and credit limit", () => {
  const stamp = Date.now().toString().slice(-8);
  let client: PrismaClient;
  let finance: FinanceService;
  let operations: OperationsService;
  let owner: PublicUser;
  let dispatcher: PublicUser;
  let financeUser: PublicUser;
  let driver: PublicUser;
  let otherDriver: PublicUser;
  let driverProfileId = "";
  let otherProfileId = "";
  let destinationId = "";
  const userIds: string[] = [];
  const profileIds: string[] = [];
  const vehicleIds: string[] = [];
  const tripIds: string[] = [];
  const bookingIds: string[] = [];
  const phones: string[] = [];

  beforeAll(async () => {
    client = createPrismaClient(databaseUrl());
    const prisma = { client } as PrismaService;
    finance = new FinanceService(prisma);
    operations = new OperationsService(prisma, finance);
    const ownerRow = await client.user.findFirst({ where: { role: "PLATFORM_OWNER", status: "ACTIVE" } });
    if (!ownerRow) throw new Error("active platform owner is required");
    owner = actor(ownerRow);
    const dispatcherRow = await client.user.create({
      data: { phone: `96361${stamp}`, passwordHash: "phase5-not-a-credential", displayName: "كونترول مالي", role: "DISPATCHER" },
    });
    const financeRow = await client.user.create({
      data: { phone: `96362${stamp}`, passwordHash: "phase5-not-a-credential", displayName: "مالية اختبار", role: "FINANCE" },
    });
    const driverRow = await client.user.create({
      data: { phone: `96363${stamp}`, passwordHash: "phase5-not-a-credential", displayName: "سائق العمولة", role: "DRIVER" },
    });
    const otherRow = await client.user.create({
      data: { phone: `96364${stamp}`, passwordHash: "phase5-not-a-credential", displayName: "سائق غير متوقف", role: "DRIVER" },
    });
    userIds.push(dispatcherRow.id, financeRow.id, driverRow.id, otherRow.id);
    dispatcher = actor(dispatcherRow);
    financeUser = actor(financeRow);
    driver = actor(driverRow);
    otherDriver = actor(otherRow);
    const profile = await client.driverProfile.create({
      data: { userId: driverRow.id, approvalStatus: "APPROVED", acceptsNearbyRequests: true },
    });
    const other = await client.driverProfile.create({
      data: { userId: otherRow.id, approvalStatus: "APPROVED", acceptsNearbyRequests: true },
    });
    driverProfileId = profile.id;
    otherProfileId = other.id;
    profileIds.push(profile.id, other.id);
    const vehicle = await client.vehicle.create({
      data: { plateNumber: `F5${stamp}`, capacity: 4, vehicleType: "VAN", approvalStatus: "APPROVED", imageUrl: "/api/files/phase5.jpg" },
    });
    const otherVehicle = await client.vehicle.create({
      data: { plateNumber: `F6${stamp}`, capacity: 4, vehicleType: "VAN", approvalStatus: "APPROVED", imageUrl: "/api/files/phase5.jpg" },
    });
    vehicleIds.push(vehicle.id, otherVehicle.id);
    await client.driverVehicleAssignment.createMany({
      data: [
        { driverProfileId: profile.id, vehicleId: vehicle.id, isPrimary: true },
        { driverProfileId: other.id, vehicleId: otherVehicle.id, isPrimary: true },
      ],
    });
    const destination = await operations.createDestination(dispatcher, {
      name: "جامعة العمولة",
      latitude: "33.513800",
      longitude: "36.276500",
    });
    destinationId = destination.id;
    await finance.setDriverRate(owner, driverProfileId, {
      ratePercent: "10",
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      reason: "نسبة اختبار السائق الأول",
    });
    await finance.setDriverRate(owner, otherProfileId, {
      ratePercent: "10",
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      reason: "نسبة اختبار السائق الثاني",
    });
    await finance.setCreditLimit(owner, driverProfileId, { amount: "1000.00", reason: "حد اختبار واسع" });
    await finance.setCreditLimit(owner, otherProfileId, { amount: "1000.00", reason: "حد اختبار للسائق الآخر" });
  });

  afterAll(async () => {
    if (!client) return;
    const commissionIds = tripIds.length
      ? (await client.tripCommission.findMany({ where: { tripId: { in: tripIds } }, select: { id: true } })).map((row) => row.id)
      : [];
    if (commissionIds.length) {
      await client.settlementAllocation.deleteMany({ where: { tripCommissionId: { in: commissionIds } } });
      await client.ledgerEntry.deleteMany({ where: { tripCommissionId: { in: commissionIds } } });
      await client.tripCommission.deleteMany({ where: { id: { in: commissionIds } } });
    }
    if (profileIds.length) {
      const settlementIds = (await client.settlement.findMany({ where: { driverProfileId: { in: profileIds } }, select: { id: true } })).map((row) => row.id);
      if (settlementIds.length) {
        await client.ledgerEntry.deleteMany({ where: { settlementId: { in: settlementIds } } });
        await client.settlement.deleteMany({ where: { id: { in: settlementIds } } });
      }
    }
    if (tripIds.length) {
      const passengers = await client.tripPassenger.findMany({ where: { tripId: { in: tripIds } }, select: { id: true } });
      const passengerIds = passengers.map((row) => row.id);
      if (passengerIds.length) await client.boardingEvent.deleteMany({ where: { tripPassengerId: { in: passengerIds } } });
      await client.tripEvent.deleteMany({ where: { tripId: { in: tripIds } } });
      await client.tripOffer.deleteMany({ where: { tripId: { in: tripIds } } });
      await client.tripVehicle.deleteMany({ where: { tripId: { in: tripIds } } });
      await client.tripPassenger.deleteMany({ where: { tripId: { in: tripIds } } });
      await client.trip.deleteMany({ where: { id: { in: tripIds } } });
    }
    await client.auditLog.deleteMany({
      where: { OR: [{ entityId: { in: [...tripIds, ...bookingIds, destinationId] } }, { actorId: { in: userIds } }] },
    });
    if (bookingIds.length) await client.booking.deleteMany({ where: { id: { in: bookingIds } } });
    if (destinationId) await client.destination.deleteMany({ where: { id: destinationId } });
    if (phones.length) await client.passengerContact.deleteMany({ where: { phone: { in: phones } } });
    if (profileIds.length) {
      await client.driverCommissionOverride.deleteMany({ where: { driverProfileId: { in: profileIds } } });
      await client.driverFinancialAccount.deleteMany({ where: { driverProfileId: { in: profileIds } } });
      await client.driverVehicleAssignment.deleteMany({ where: { driverProfileId: { in: profileIds } } });
      await client.driverProfile.deleteMany({ where: { id: { in: profileIds } } });
    }
    if (vehicleIds.length) await client.vehicle.deleteMany({ where: { id: { in: vehicleIds } } });
    if (userIds.length) await client.user.deleteMany({ where: { id: { in: userIds } } });
    await client.$disconnect();
  });

  async function completedTrip(fare: string, phone: string, profileId: string, actorUser: PublicUser): Promise<string> {
    phones.push(phone);
    const departs = new Date(Date.now() + 20 * 60 * 1000);
    const arrives = new Date(departs.getTime() + 30 * 60 * 1000);
    const trip = await operations.createTrip(dispatcher, {
      direction: "OUTBOUND",
      destinationId,
      scheduledAt: departs.toISOString(),
      arrivesAt: arrives.toISOString(),
      isDaily: false,
    });
    tripIds.push(trip.id);
    const booking = await operations.createBooking(dispatcher, {
      passengerName: "راكب العمولة",
      passengerPhone: phone,
      direction: "OUTBOUND",
      tripId: trip.id,
      pickupLatitude: "33.520100",
      pickupLongitude: "36.280200",
      fareAmount: fare,
    });
    bookingIds.push(booking.id);
    await operations.assignTrip(dispatcher, trip.id, profileId);
    const seat = await client.tripPassenger.findFirstOrThrow({ where: { tripId: trip.id, bookingId: booking.id } });
    await operations.recordBoarding(actorUser, trip.id, seat.id, { status: "BOARDED" });
    for (const status of ["DRIVER_ARRIVED", "IN_PROGRESS", "COMPLETED"] as const) {
      await operations.changeStatus(
        actorUser,
        trip.id,
        status,
        undefined,
        undefined,
        status === "COMPLETED" ? { latitude: "33.513800", longitude: "36.276500" } : undefined,
      );
    }
    return trip.id;
  }

  it("accrues one commission for a completed boarded trip and ignores a repeated accrual", async () => {
    const tripId = await completedTrip("100.00", `96370${stamp}`, driverProfileId, driver);
    const first = await client.tripCommission.findUniqueOrThrow({ where: { tripId } });
    expect(first.commissionAmount.toString()).toMatch(/^10(\.00)?$/);
    expect(first.commissionRateApplied.toString()).toMatch(/^10(\.000)?$/);
    expect(first.currency).toBe("SYP");
    const ledger = await client.ledgerEntry.findMany({ where: { tripCommissionId: first.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.direction).toBe("DEBIT");
    expect(ledger[0]?.type).toBe("COMMISSION_ACCRUAL");
    await client.$transaction((tx) => finance.accrueCompletedTrip(tx, tripId, owner.id));
    expect(await client.tripCommission.count({ where: { tripId } })).toBe(1);
    expect(await client.ledgerEntry.count({ where: { idempotencyKey: `commission:${tripId}` } })).toBe(1);
  });

  it("does not accrue commission for a cancelled trip or for collected passenger cash", async () => {
    phones.push(`96371${stamp}`);
    const departs = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const arrives = new Date(departs.getTime() + 20 * 60 * 1000);
    const trip = await operations.createTrip(dispatcher, {
      direction: "RETURN",
      destinationId,
      scheduledAt: departs.toISOString(),
      arrivesAt: arrives.toISOString(),
      isDaily: false,
    });
    tripIds.push(trip.id);
    const booking = await operations.createBooking(dispatcher, {
      passengerName: "راكب ملغى",
      passengerPhone: phones[phones.length - 1] ?? "",
      direction: "RETURN",
      tripId: trip.id,
      pickupLatitude: "33.513800",
      pickupLongitude: "36.276500",
      fareAmount: "40.00",
    });
    bookingIds.push(booking.id);
    await operations.assignTrip(dispatcher, trip.id, driverProfileId);
    await operations.changeStatus(dispatcher, trip.id, "CANCELLED", "إلغاء قبل التنفيذ");
    expect(await client.tripCommission.count({ where: { tripId: trip.id } })).toBe(0);

    const collected = await completedTrip("20.00", `96377${stamp}`, driverProfileId, driver);
    const before = await client.ledgerEntry.count({ where: { driverProfileId, type: "DRIVER_PAYMENT" } });
    await operations.markFareCollected(driver, collected);
    expect(await client.ledgerEntry.count({ where: { driverProfileId, type: "DRIVER_PAYMENT" } })).toBe(before);
  });

  it("keeps the applied rate when a later driver rate is created", async () => {
    const tripId = await completedTrip("50.00", `96372${stamp}`, driverProfileId, driver);
    const before = await client.tripCommission.findUniqueOrThrow({ where: { tripId } });
    await finance.setDriverRate(owner, driverProfileId, {
      ratePercent: "25",
      effectiveFrom: "2099-01-01T00:00:00.000Z",
      reason: "نسبة لاحقة لا تمس التاريخ",
    });
    const after = await client.tripCommission.findUniqueOrThrow({ where: { tripId } });
    expect(after.commissionRateApplied.toString()).toBe(before.commissionRateApplied.toString());
    expect(after.commissionAmount.toString()).toBe(before.commissionAmount.toString());
    expect(after.commissionAmount.toString()).toMatch(/^5(\.00)?$/);
  });

  it("reduces the balance by a partial payment and keeps overpayment as credit", async () => {
    const tripId = await completedTrip("100.00", `96373${stamp}`, otherProfileId, otherDriver);
    const partial = await finance.recordSettlement(financeUser, {
      driverProfileId: otherProfileId,
      amount: "4.00",
      method: "CASH",
      receivedAt: new Date().toISOString(),
      receiptNumber: `R4${stamp}`,
      idempotencyKey: `partial-${stamp}`,
    });
    expect(partial.status).toBe("RECORDED");
    const again = await finance.recordSettlement(financeUser, {
      driverProfileId: otherProfileId,
      amount: "4.00",
      method: "CASH",
      receivedAt: new Date().toISOString(),
      receiptNumber: `R4${stamp}`,
      idempotencyKey: `partial-${stamp}`,
    });
    expect(again.id).toBe(partial.id);
    await expect(finance.approveSettlement(financeUser, partial.id)).rejects.toBeInstanceOf(FinanceError);
    await finance.reviewSettlement(financeUser, partial.id, "PENDING_REVIEW", "تمت المطابقة");
    await finance.approveSettlement(owner, partial.id);
    const open = await client.tripCommission.findUniqueOrThrow({ where: { tripId } });
    expect(open.status).toBe("PARTIALLY_PAID");
    const afterPartial = await finance.ownSummary(otherDriver);
    expect(afterPartial.outstanding).toBe("6.00");
    expect(afterPartial.creditLimitAmount).toBe("1000.00");
    expect(afterPartial.cashFareNote).toContain("ليست تسديدًا");

    const extra = await finance.recordSettlement(financeUser, {
      driverProfileId: otherProfileId,
      amount: "10.00",
      method: "CASH",
      receivedAt: new Date().toISOString(),
      receiptNumber: `R10${stamp}`,
      idempotencyKey: `extra-${stamp}`,
    });
    await finance.approveSettlement(owner, extra.id);
    const paid = await client.tripCommission.findUniqueOrThrow({ where: { tripId } });
    expect(paid.status).toBe("PAID");
    const afterExtra = await finance.ownSummary(otherDriver);
    expect(afterExtra.outstanding).toBe("-4.00");
  });

  it("blocks only the driver who would pass the credit limit", async () => {
    const current = await finance.ownSummary(driver);
    const room = Number(current.outstanding) + 15;
    await finance.setCreditLimit(owner, driverProfileId, { amount: room.toFixed(2), reason: "حد يسمح برحلة واحدة إضافية فقط" });
    const makeOpen = async (phone: string) => {
      phones.push(phone);
      const departs = new Date(Date.now() + 5 * 60 * 60 * 1000);
      const arrives = new Date(departs.getTime() + 20 * 60 * 1000);
      const trip = await operations.createTrip(dispatcher, {
        direction: "OUTBOUND",
        destinationId,
        scheduledAt: departs.toISOString(),
        arrivesAt: arrives.toISOString(),
        isDaily: false,
      });
      tripIds.push(trip.id);
      const booking = await operations.createBooking(dispatcher, {
        passengerName: "راكب الحد",
        passengerPhone: phone,
        direction: "OUTBOUND",
        tripId: trip.id,
        pickupLatitude: "33.520100",
        pickupLongitude: "36.280200",
        fareAmount: "100.00",
      });
      bookingIds.push(booking.id);
      return trip.id;
    };
    const first = await makeOpen(`96374${stamp}`);
    const second = await makeOpen(`96375${stamp}`);
    const raced = await Promise.allSettled([
      operations.assignTrip(dispatcher, first, driverProfileId),
      operations.assignTrip(dispatcher, second, driverProfileId),
    ]);
    expect(raced.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const rejected = raced.find((item) => item.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({ code: "CREDIT" });

    const otherTrip = await makeOpen(`96376${stamp}`);
    await expect(operations.assignTrip(dispatcher, otherTrip, otherProfileId)).resolves.toMatchObject({ id: otherTrip });
    await finance.setCreditLimit(owner, driverProfileId, { amount: "1000.00", reason: "إعادة الحد بعد الاختبار" });
  });

  it("refuses a dispatcher from changing the commission rate", async () => {
    await expect(
      finance.setPolicy(dispatcher, {
        ratePercent: "5",
        effectiveFrom: new Date().toISOString(),
        reason: "محاولة غير مخولة",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
