import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPrismaClient, type PrismaClient } from "@flyvan/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PublicUser } from "../auth/public-user";
import { PrismaService } from "../prisma/prisma.service";
import { OperationsError } from "./operations.errors";
import { OperationsService } from "./operations.service";

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

describe("booking and trip flow", () => {
  const stamp = Date.now().toString().slice(-8);
  const passengerPhone = `9639${stamp}`;
  let client: PrismaClient;
  let service: OperationsService;
  let dispatcher: PublicUser;
  let driver: PublicUser;
  let otherDriver: PublicUser;
  let owner: PublicUser;
  const userIds: string[] = [];
  const profileIds: string[] = [];
  const vehicleIds: string[] = [];
  const bookingIds: string[] = [];
  const tripIds: string[] = [];
  const destinationIds: string[] = [];
    const returnPhone = `96352${stamp}`;
    const swapPhone = `9634${stamp}`;
    const extraPhones: string[] = [];

  beforeAll(async () => {
    client = createPrismaClient(databaseUrl());
    service = new OperationsService({ client } as PrismaService);
    const ownerRow = await client.user.findFirst({ where: { role: "PLATFORM_OWNER", status: "ACTIVE" } });
    if (!ownerRow) throw new Error("active platform owner is required");
    owner = actor(ownerRow);

    const dispatcherRow = await client.user.create({
      data: {
        phone: `9636${stamp}`,
        passwordHash: "phase4-not-a-credential",
        displayName: "كونترول اختبار",
        role: "DISPATCHER",
      },
    });
    const driverUser = await client.user.create({
      data: {
        phone: `9638${stamp}`,
        passwordHash: "phase4-not-a-credential",
        displayName: "سائق اختبار رحلة",
        role: "DRIVER",
      },
    });
    const otherUser = await client.user.create({
      data: {
        phone: `9637${stamp}`,
        passwordHash: "phase4-not-a-credential",
        displayName: "سائق آخر",
        role: "DRIVER",
      },
    });
    userIds.push(dispatcherRow.id, driverUser.id, otherUser.id);
    dispatcher = actor(dispatcherRow);
    driver = actor(driverUser);
    otherDriver = actor(otherUser);

    const profile = await client.driverProfile.create({
      data: { userId: driverUser.id, approvalStatus: "APPROVED", acceptsNearbyRequests: true, nearbyRadiusMeters: 3000 },
    });
    const otherProfile = await client.driverProfile.create({
      data: { userId: otherUser.id, approvalStatus: "APPROVED", acceptsNearbyRequests: true },
    });
    profileIds.push(profile.id, otherProfile.id);
    const vehicle = await client.vehicle.create({
      data: {
        plateNumber: `P4${stamp}`,
        capacity: 4,
        vehicleType: "VAN",
        approvalStatus: "APPROVED",
        imageUrl: "/api/files/phase4-test.jpg",
      },
    });
    vehicleIds.push(vehicle.id);
    await client.driverVehicleAssignment.create({
      data: { driverProfileId: profile.id, vehicleId: vehicle.id, isPrimary: true },
    });
    await client.driverFinancialAccount.createMany({
      data: [profile.id, otherProfile.id].map((driverProfileId) => ({
        driverProfileId,
        currency: "SYP",
        creditLimitAmount: "1000000.00",
      })),
    });
    await client.driverCommissionOverride.createMany({
      data: [profile.id, otherProfile.id].map((driverProfileId) => ({
        driverProfileId,
        ratePercent: "10.000",
        effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
        reason: "نسبة اختبار حتى لا يتوقف الإسناد",
        createdById: owner.id,
      })),
    });
  });

  afterAll(async () => {
    if (!client) return;
    const childIds = tripIds.length
      ? (await client.trip.findMany({ where: { parentTripId: { in: tripIds } }, select: { id: true } })).map((row) => row.id)
      : [];
    const removableIds = [...childIds, ...tripIds];
    const passengers = removableIds.length
      ? await client.tripPassenger.findMany({ where: { tripId: { in: removableIds } }, select: { id: true } })
      : [];
    const passengerIds = passengers.map((row) => row.id);
    if (passengerIds.length) await client.boardingEvent.deleteMany({ where: { tripPassengerId: { in: passengerIds } } });
    for (const ids of [childIds, tripIds]) {
      if (!ids.length) continue;
      await client.tripEvent.deleteMany({ where: { tripId: { in: ids } } });
      await client.tripOffer.deleteMany({ where: { tripId: { in: ids } } });
      await client.tripVehicle.deleteMany({ where: { tripId: { in: ids } } });
      await client.tripPassenger.deleteMany({ where: { tripId: { in: ids } } });
      await client.trip.deleteMany({ where: { id: { in: ids } } });
    }
    if (bookingIds.length || removableIds.length || destinationIds.length) {
      await client.auditLog.deleteMany({ where: { entityId: { in: [...bookingIds, ...removableIds, ...destinationIds] } } });
    }
    if (bookingIds.length) await client.booking.deleteMany({ where: { id: { in: bookingIds } } });
    if (destinationIds.length) await client.destination.deleteMany({ where: { id: { in: destinationIds } } });
    await client.passengerContact.deleteMany({ where: { phone: { in: [passengerPhone, returnPhone, swapPhone, ...extraPhones] } } });
    if (profileIds.length) {
      await client.driverCommissionOverride.deleteMany({ where: { driverProfileId: { in: profileIds } } });
      await client.driverFinancialAccount.deleteMany({ where: { driverProfileId: { in: profileIds } } });
      await client.driverVehicleAssignment.deleteMany({ where: { driverProfileId: { in: profileIds } } });
    }
    if (vehicleIds.length) await client.vehicle.deleteMany({ where: { id: { in: vehicleIds } } });
    if (profileIds.length) await client.driverProfile.deleteMany({ where: { id: { in: profileIds } } });
    if (userIds.length) await client.user.deleteMany({ where: { id: { in: userIds } } });
    await client.$disconnect();
  });

  it("links one round-trip booking to two existing trips and does not accrue commission", async () => {
    const destination = await service.createDestination(dispatcher, {
      name: "جامعة الاختبار",
      latitude: "33.5138",
      longitude: "36.2765",
      addressNote: "البوابة الرئيسية",
      notes: "الموقف الشمالي",
    });
    destinationIds.push(destination.id);
    const departs = new Date(Date.now() + 60 * 60 * 1000);
    const arrives = new Date(departs.getTime() + 60 * 60 * 1000);
    await expect(
      service.createTrip(dispatcher, {
        direction: "OUTBOUND",
        destinationId: destination.id,
        scheduledAt: departs.toISOString(),
        arrivesAt: departs.toISOString(),
      }),
    ).rejects.toMatchObject({ code: "TIME" });
    const outboundTrip = await service.createTrip(dispatcher, {
      direction: "OUTBOUND",
      destinationId: destination.id,
      scheduledAt: departs.toISOString(),
      arrivesAt: arrives.toISOString(),
    });
    const returnTrip = await service.createTrip(dispatcher, {
      direction: "RETURN",
      destinationId: destination.id,
      scheduledAt: departs.toISOString(),
      arrivesAt: arrives.toISOString(),
      isDaily: false,
    });
    expect(outboundTrip.isDaily).toBe(true);
    expect(returnTrip.isDaily).toBe(false);
    tripIds.push(outboundTrip.id, returnTrip.id);

    const booking = await service.createBooking(dispatcher, {
      passengerName: "راكب اختبار",
      passengerPhone,
      direction: "ROUND_TRIP",
      outboundTripId: outboundTrip.id,
      returnTripId: returnTrip.id,
      pickupLatitude: "33.5201",
      pickupLongitude: "36.2802",
      fareAmount: "25.5",
      returnFareAmount: "20",
    });
    bookingIds.push(booking.id);

    expect(booking.legs).toHaveLength(2);
    expect(booking.legs.map((leg) => leg.tripId).sort()).toEqual([outboundTrip.id, returnTrip.id].sort());
    expect(booking.boardingCodes).toHaveLength(2);
    expect(booking.boardingCodes.every((code) => /^\d{4}$/.test(code.boardingCode))).toBe(true);
    const returnSeat = await client.tripPassenger.findFirst({ where: { tripId: returnTrip.id, bookingId: booking.id } });
    const outboundSeat = await client.tripPassenger.findFirst({ where: { tripId: outboundTrip.id, bookingId: booking.id } });
    expect(returnSeat?.pickupLatitude?.toString().startsWith("33.5138")).toBe(true);
    expect(outboundSeat?.pickupAt?.getTime()).toBe(departs.getTime());
    expect(returnSeat?.fareAmount?.toString().startsWith("20")).toBe(true);
    expect(returnSeat?.fareCurrency).toBe("SYP");
    expect(outboundSeat?.fareCurrency).toBe("SYP");
    const contact = await client.passengerContact.findUnique({ where: { phone: passengerPhone } });
    expect(contact?.userId).toBeNull();

    await expect(service.changeStatus(dispatcher, outboundTrip.id, "COMPLETED")).rejects.toMatchObject({ code: "TRANSITION" });
    await expect(service.adjustFare(dispatcher, booking.id, outboundTrip.id, "30.00", "تعديل غير مصرح")).rejects.toBeInstanceOf(OperationsError);
    const adjusted = await service.adjustFare(owner, booking.id, outboundTrip.id, "30", "تصحيح أجرة الذهاب");
    expect(adjusted.legs.find((leg) => leg.tripId === outboundTrip.id)?.fareAmount).toBe("30.00");

    const assigned = await service.assignTrip(dispatcher, outboundTrip.id, profileIds[0] ?? "");
    expect(assigned.passengers[0]?.phone).toBe(passengerPhone);
    expect(assigned.vehicles).toHaveLength(1);
    expect(assigned.capacity).toBe(4);
    expect(assigned.passengers[0]?.pickupAt).toBeTruthy();
    const hidden = await service.listTrips(otherDriver, { page: 1, pageSize: 20, search: outboundTrip.reference });
    expect(hidden.total).toBe(0);
    expect(hidden.items.every((item) => item.passengers.length === 0)).toBe(true);

    for (const status of ["DRIVER_ARRIVED", "IN_PROGRESS", "COMPLETED"] as const) {
      const next = await service.changeStatus(
        driver,
        outboundTrip.id,
        status,
        undefined,
        undefined,
        status === "COMPLETED" ? { latitude: "33.513800", longitude: "36.276500" } : undefined,
      );
      expect(next.status).toBe(status);
    }
    expect(await client.tripCommission.count({ where: { tripId: { in: tripIds } } })).toBe(0);

    const returnBooking = await service.createBooking(dispatcher, {
      passengerName: "راكب الإياب",
      passengerPhone: returnPhone,
      direction: "RETURN",
      tripId: returnTrip.id,
      pickupLatitude: "33.5138",
      pickupLongitude: "36.2765",
      fareAmount: "15.00",
    });
    bookingIds.push(returnBooking.id);
    const cancelled = await service.cancelBooking(dispatcher, returnBooking.id, "الراكب ألغى الإياب");
    expect(cancelled.status).toBe("CANCELLED");
    const stillOpen = await client.trip.findUnique({ where: { id: returnTrip.id } });
    expect(stillOpen?.status).toBe("PENDING_ASSIGNMENT");
    expect(await client.tripCommission.count({ where: { tripId: { in: tripIds } } })).toBe(0);
  }, 30_000);

  it("replaces a linked vehicle, blocks the last unlink while passengers remain, cancels, and deletes only before the trip starts", async () => {
    const destinationId = destinationIds[0];
    if (!destinationId) throw new Error("destination missing");
    const spareVehicle = await client.vehicle.create({
      data: {
        plateNumber: `P5${stamp}`,
        capacity: 7,
        vehicleType: "VAN",
        approvalStatus: "APPROVED",
        imageUrl: "/api/files/phase4-test.jpg",
      },
    });
    vehicleIds.push(spareVehicle.id);
    await client.driverVehicleAssignment.create({
      data: { driverProfileId: profileIds[1] ?? "", vehicleId: spareVehicle.id, isPrimary: true },
    });

    const departs = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const arrives = new Date(departs.getTime() + 45 * 60 * 1000);
    const trip = await service.createTrip(dispatcher, {
      direction: "OUTBOUND",
      destinationId,
      scheduledAt: departs.toISOString(),
      arrivesAt: arrives.toISOString(),
      isDaily: false,
    });
    tripIds.push(trip.id);
    const linked = await service.linkVehicle(dispatcher, trip.id, profileIds[0] ?? "");
    expect(linked.vehicles).toHaveLength(1);
    const primaryVehicleId = linked.vehicles[0]?.vehicleId ?? "";
    await expect(service.unlinkVehicle(driver, trip.id, primaryVehicleId)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const withSpare = await service.linkVehicle(dispatcher, trip.id, profileIds[1] ?? "");
    expect(withSpare.vehicles).toHaveLength(2);
    expect(withSpare.capacity).toBe(11);
    const unlinked = await service.unlinkVehicle(dispatcher, trip.id, primaryVehicleId);
    expect(unlinked.vehicles.map((item) => item.vehicleId)).toEqual([spareVehicle.id]);
    expect(unlinked.status).toBe("ASSIGNED");

    const replaced = await service.replaceVehicle(dispatcher, trip.id, spareVehicle.id, profileIds[0] ?? "");
    expect(replaced.vehicles).toHaveLength(1);
    expect(replaced.vehicles[0]?.vehicleId).toBe(primaryVehicleId);
    expect(replaced.driverName).toBe("سائق اختبار رحلة");

    const booking = await service.createBooking(dispatcher, {
      passengerName: "راكب الاستبدال",
      passengerPhone: swapPhone,
      direction: "OUTBOUND",
      tripId: trip.id,
      pickupLatitude: "33.5201",
      pickupLongitude: "36.2802",
      fareAmount: "12.00",
    });
    bookingIds.push(booking.id);
    await expect(service.unlinkVehicle(dispatcher, trip.id, primaryVehicleId)).rejects.toMatchObject({ code: "CAPACITY" });

    const cancelled = await service.changeStatus(dispatcher, trip.id, "CANCELLED", "ألغى الكونترول الرحلة قبل الانطلاق");
    expect(cancelled.status).toBe("CANCELLED");
    expect(await client.trip.findUnique({ where: { id: trip.id } })).not.toBeNull();
    expect((await client.booking.findUnique({ where: { id: booking.id } }))?.status).toBe("CANCELLED");

    const startedId = tripIds[0] ?? "";
    expect(await service.deleteTrip(dispatcher, startedId, "حذف رحلة مكتملة بلا عمولة")).toEqual({ deleted: true });
    expect(await client.trip.findUnique({ where: { id: startedId } })).toBeNull();
    tripIds.splice(tripIds.indexOf(startedId), 1);
    const removed = await service.deleteTrip(dispatcher, trip.id, "حذف رحلة ملغاة بلا عمولة");
    expect(removed).toEqual({ deleted: true });
    expect(await client.trip.findUnique({ where: { id: trip.id } })).toBeNull();
    tripIds.splice(tripIds.indexOf(trip.id), 1);
  }, 30_000);

  it("keeps a running trip when one of several vehicles is disabled, and edits the trip before it starts", async () => {
    const destinationId = destinationIds[0];
    if (!destinationId) throw new Error("destination missing");
    const departs = new Date(Date.now() + 20 * 60 * 1000);
    const arrives = new Date(departs.getTime() + 40 * 60 * 1000);
    const created = await service.createTrip(dispatcher, {
      direction: "OUTBOUND",
      destinationId,
      scheduledAt: departs.toISOString(),
      arrivesAt: arrives.toISOString(),
      isDaily: false,
      notes: "قبل التعديل",
    });
    tripIds.push(created.id);
    const edited = await service.updateTrip(dispatcher, created.id, {
      direction: "OUTBOUND",
      destinationId,
      scheduledAt: departs.toISOString(),
      arrivesAt: arrives.toISOString(),
      isDaily: false,
      notes: "بعد التعديل",
    });
    expect(edited.notes).toBe("بعد التعديل");

    await service.linkVehicle(dispatcher, created.id, profileIds[0] ?? "");
    const both = await service.linkVehicle(dispatcher, created.id, profileIds[1] ?? "");
    expect(both.vehicles.filter((item) => !item.disabledAt)).toHaveLength(2);
    const running = await service.changeStatus(driver, created.id, "IN_PROGRESS");
    expect(running.status).toBe("IN_PROGRESS");
    await expect(
      service.updateTrip(dispatcher, created.id, {
        direction: "OUTBOUND",
        destinationId,
        scheduledAt: departs.toISOString(),
        arrivesAt: arrives.toISOString(),
        notes: "بعد البدء",
      }),
    ).rejects.toMatchObject({ code: "STATE" });

    const primary = both.vehicles.find((item) => item.driverName === "سائق اختبار رحلة");
    if (!primary) throw new Error("primary vehicle missing");
    const disabled = await service.disableVehicle(dispatcher, created.id, primary.vehicleId, "تعطلت مركبة السائق الأول");
    expect(disabled.status).toBe("IN_PROGRESS");
    expect(disabled.vehicles.filter((item) => !item.disabledAt)).toHaveLength(1);
    expect(disabled.capacity).toBe(7);
    expect(disabled.driverName).toBe("سائق آخر");
    const hidden = await service.listTrips(driver, { page: 1, pageSize: 20, search: created.reference });
    expect(hidden.total).toBe(0);
    const visible = await service.listTrips(otherDriver, { page: 1, pageSize: 20, search: created.reference });
    expect(visible.total).toBe(1);

    const lastId = disabled.vehicles.find((item) => !item.disabledAt)?.vehicleId ?? "";
    await expect(service.disableVehicle(dispatcher, created.id, lastId, "محاولة تعطيل الأخيرة")).rejects.toMatchObject({ code: "STATE" });
    expect((await client.trip.findUnique({ where: { id: created.id } }))?.status).toBe("IN_PROGRESS");
  }, 30_000);

  it("confirms a one-time vehicle run for the nearest passengers and keeps the permanent trip off the driver list", async () => {
    const destinationId = destinationIds[0];
    if (!destinationId) throw new Error("destination missing");
    const departs = new Date(Date.now() + 26 * 60 * 60 * 1000);
    const arrives = new Date(departs.getTime() + 45 * 60 * 1000);
    const parent = await service.createTrip(dispatcher, {
      direction: "OUTBOUND",
      destinationId,
      scheduledAt: departs.toISOString(),
      arrivesAt: arrives.toISOString(),
      isDaily: true,
    });
    tripIds.push(parent.id);
    const pins = [
      ["33.521", "36.281"],
      ["33.523", "36.283"],
      ["33.53", "36.29"],
      ["33.54", "36.3"],
      ["33.6", "36.4"],
    ];
    const phones = pins.map((_, index) => `96313${stamp}${index}`);
    extraPhones.push(...phones);
    for (const [index, pin] of pins.entries()) {
      const booking = await service.createBooking(dispatcher, {
        passengerName: `راكب قرب ${index + 1}`,
        passengerPhone: phones[index] ?? "",
        direction: "OUTBOUND",
        tripId: parent.id,
        pickupLatitude: pin[0] ?? "",
        pickupLongitude: pin[1] ?? "",
        fareAmount: "10.00",
      });
      bookingIds.push(booking.id);
    }
    const linked = await service.linkVehicle(dispatcher, parent.id, profileIds[0] ?? "");
    expect(linked.passengerCount).toBe(5);
    expect(linked.vehiclesNeeded).toBe(1);
    expect(linked.seatShortfall).toBe(1);
    expect((await service.listTrips(driver, { page: 1, pageSize: 20, search: parent.reference })).total).toBe(1);
    const vehicleId = linked.vehicles[0]?.vehicleId ?? "";
    const preview = await service.previewRun(dispatcher, parent.id, {
      vehicleId,
      latitude: "33.52",
      longitude: "36.28",
      scheduledAt: departs.toISOString(),
    });
    expect(preview.suggestedIds).toHaveLength(4);
    expect(preview.passengers.at(-1)?.phone).toBe(phones[4]);
    expect(preview.suggestedIds).not.toContain(preview.passengers.at(-1)?.id);
    const run = await service.confirmRun(dispatcher, parent.id, {
      vehicleId,
      passengerIds: preview.suggestedIds,
      latitude: "33.52",
      longitude: "36.28",
      scheduledAt: departs.toISOString(),
      arrivesAt: arrives.toISOString(),
    });
    tripIds.push(run.id);
    expect(run.parentTripId).toBe(parent.id);
    expect(run.isDaily).toBe(false);
    expect(run.vehicles).toHaveLength(1);
    expect(run.passengers).toHaveLength(4);
    expect((await service.listTrips(driver, { page: 1, pageSize: 20, search: parent.reference })).total).toBe(0);
    const visibleRun = await service.listTrips(driver, { page: 1, pageSize: 20, search: run.reference });
    expect(visibleRun.total).toBe(1);
    expect(visibleRun.items[0]?.passengers).toHaveLength(4);
    await expect(
      service.confirmRun(dispatcher, parent.id, {
        vehicleId,
        passengerIds: preview.suggestedIds,
        latitude: "33.52",
        longitude: "36.28",
        scheduledAt: departs.toISOString(),
        arrivesAt: arrives.toISOString(),
      }),
    ).rejects.toMatchObject({ code: "STATE" });
    const blockedPhone = `96314${stamp}`;
    extraPhones.push(blockedPhone);
    await expect(
      service.createBooking(dispatcher, {
        passengerName: "راكب على الفرعية",
        passengerPhone: blockedPhone,
        direction: "OUTBOUND",
        tripId: run.id,
        pickupLatitude: "33.52",
        pickupLongitude: "36.28",
        fareAmount: "10.00",
      }),
    ).rejects.toMatchObject({ code: "LEG" });
  }, 30_000);

  it("lets the driver report a breakdown and only then lets dispatch cancel the running trip", async () => {
    const destinationId = destinationIds[0];
    if (!destinationId) throw new Error("destination missing");
    const departs = new Date(Date.now() + 20 * 60 * 1000);
    const arrives = new Date(departs.getTime() + 40 * 60 * 1000);
    const trip = await service.createTrip(dispatcher, {
      direction: "OUTBOUND",
      destinationId,
      scheduledAt: departs.toISOString(),
      arrivesAt: arrives.toISOString(),
      isDaily: false,
    });
    tripIds.push(trip.id);
    await service.linkVehicle(dispatcher, trip.id, profileIds[0] ?? "");
    await service.changeStatus(driver, trip.id, "IN_PROGRESS");
    await expect(
      service.changeStatus(driver, trip.id, "COMPLETED", undefined, undefined, { latitude: "34.000000", longitude: "36.000000" }),
    ).rejects.toMatchObject({ code: "STATE" });
    await expect(service.changeStatus(dispatcher, trip.id, "CANCELLED", "إلغاء بلا بلاغ")).rejects.toMatchObject({ code: "TRANSITION" });
    await expect(service.reportBreakdown(dispatcher, trip.id, "عطل")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const reported = await service.reportBreakdown(driver, trip.id, "عطل في المحرك");
    expect(reported.breakdownNote).toBe("عطل في المحرك");
    expect(reported.status).toBe("IN_PROGRESS");
    const again = await service.reportBreakdown(driver, trip.id);
    expect(again.breakdownReportedAt).toBe(reported.breakdownReportedAt);
    const alerts = await service.listBreakdowns(dispatcher);
    expect(alerts.items.some((item) => item.id === trip.id)).toBe(true);
    const cancelled = await service.changeStatus(dispatcher, trip.id, "CANCELLED", "إلغاء بعد تعثر الرحلة والإسناد البديل هاتفي");
    expect(cancelled.status).toBe("CANCELLED");
    expect((await service.listBreakdowns(dispatcher)).items.some((item) => item.id === trip.id)).toBe(false);
  }, 30_000);

  it("keeps a public seat request pending until dispatch locks the fare", async () => {
    const destination = await service.createDestination(dispatcher, {
      name: "وجهة الحجز العام",
      latitude: "33.510000",
      longitude: "36.290000",
    });
    destinationIds.push(destination.id);
    const departs = new Date(Date.now() + 90 * 60 * 1000);
    const arrives = new Date(departs.getTime() + 40 * 60 * 1000);
    const trip = await service.createTrip(dispatcher, {
      direction: "OUTBOUND",
      destinationId: destination.id,
      scheduledAt: departs.toISOString(),
      arrivesAt: arrives.toISOString(),
      isDaily: false,
    });
    tripIds.push(trip.id);
    const phone = `9633${stamp}`;
    extraPhones.push(phone);
    const requested = await service.requestPublicBooking({
      passengerName: "راكب الرابط",
      passengerPhone: phone,
      tripId: trip.id,
      seatCount: 2,
      pickupLatitude: "33.520000",
      pickupLongitude: "36.280000",
    });
    expect(requested.status).toBe("PENDING");
    expect(requested.seatCount).toBe(2);
    const listed = await service.listPublicTrips();
    expect(listed.items.some((item) => item.id === trip.id)).toBe(true);
    const confirmed = await service.confirmBooking(dispatcher, (await client.booking.findFirstOrThrow({ where: { reference: requested.reference } })).id, "25.00");
    bookingIds.push(confirmed.id);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.seatCount).toBe(2);
    expect(confirmed.legs[0]?.fareAmount).toBe("25.00");
    expect(confirmed.boardingCodes).toHaveLength(1);
  }, 30_000);
});
