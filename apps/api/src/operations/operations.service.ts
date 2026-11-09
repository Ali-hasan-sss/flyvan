import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { decideOffer, type AreaLink } from "@flyvan/types";
import { normalizePhone } from "../auth/identity";
import type { PublicUser } from "../auth/public-user";
import { FinanceError } from "../finance/finance.errors";
import { FinanceService } from "../finance/finance.service";
import { PrismaService } from "../prisma/prisma.service";
import { OperationsError } from "./operations.errors";
import { createRouteProvider, isRouteProviderNotConfigured, OsrmRouteError } from "../routing/osrm-route.provider";
import {
  arrivalState,
  driverMayStartTrip,
  serviceArrivesAt,
  serviceDepartsAt,
  canCancelBrokenTrip,
  canTransitionTrip,
  distanceMeters,
  insideDestinationFinishCircle,
  formatDailyReference,
  formatStoredFare,
  normalizeCoordinate,
  normalizeFare,
  PLATFORM_CURRENCY,
  planPickupTimes,
  planVehicleNeed,
  alignRouteLegs,
  nearestPassengerOrder,
  rankByStraightLine,
  revealPassengerDetails,
  routeStopOrder,
  selectDriverTrip,
  type TripStatusName,
} from "./operations.rules";

const OFFER_TTL_MS = 15 * 60 * 1000;
const DRIVER_STATUSES = new Set<TripStatusName>(["DRIVER_ARRIVED", "IN_PROGRESS", "COMPLETED", "NO_SHOW"]);
const BOOKABLE = new Set(["PENDING_ASSIGNMENT", "OFFERED", "ASSIGNED", "DRIVER_ARRIVED"]);

type BookingRow = {
  id: string;
  reference: string;
  direction: string;
  status: string;
  pickupLabel: string;
  pickupLatitude: { toString(): string } | null;
  pickupLongitude: { toString(): string } | null;
  scheduledAt: Date;
  notes: string | null;
  cancelReason: string | null;
  createdAt: Date;
  passengerContact: { id: string; fullName: string; phone: string };
  passengers: {
    fareAmount: { toString(): string } | null;
    fareCurrency: string | null;
    pickupNote: string | null;
    seatCount: number;
    trip: {
      id: string;
      reference: string;
      direction: string;
      status: string;
      scheduledAt: Date;
      destination: { id: string; name: string; latitude: { toString(): string }; longitude: { toString(): string } };
    };
  }[];
};

@Injectable()
export class OperationsService {
  private readonly routes = createRouteProvider();
  private readonly finance: FinanceService;

  constructor(
    private readonly prisma: PrismaService,
    finance?: FinanceService,
  ) {
    this.finance = finance ?? new FinanceService(prisma);
  }

  async listBookings(
    actor: PublicUser,
    query: { page: number; pageSize: number; search?: string; sort?: string; direction?: "asc" | "desc" },
  ) {
    await this.assertAny(actor, ["BOOKINGS_MANAGE", "TRIPS_VIEW_ALL"]);
    const term = query.search?.trim();
    const where = term
      ? {
          OR: [
            { reference: { contains: term, mode: "insensitive" as const } },
            { passengerContact: { fullName: { contains: term, mode: "insensitive" as const } } },
            { passengerContact: { phone: { contains: term, mode: "insensitive" as const } } },
            { passengers: { some: { trip: { destination: { name: { contains: term, mode: "insensitive" as const } } } } } },
            { passengers: { some: { trip: { reference: { contains: term, mode: "insensitive" as const } } } } },
          ],
        }
      : {};
    const direction = query.direction === "asc" ? ("asc" as const) : ("desc" as const);
    const orderBy =
      query.sort === "createdAt"
        ? { createdAt: direction }
        : query.sort === "reference"
          ? { reference: direction }
          : { scheduledAt: direction };
    const [total, rows] = await Promise.all([
      this.prisma.client.booking.count({ where }),
      this.prisma.client.booking.findMany({
        where,
        include: bookingInclude,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toBookingView), page: query.page, pageSize: query.pageSize, total };
  }

  async createBooking(
    actor: PublicUser,
    input: {
      passengerName: string;
      passengerPhone: string;
      direction: "OUTBOUND" | "RETURN" | "ROUND_TRIP";
      tripId?: string;
      outboundTripId?: string;
      returnTripId?: string;
      pickupLatitude: string;
      pickupLongitude: string;
      pickupNote?: string;
      fareAmount: string;
      returnFareAmount?: string;
      notes?: string;
      seatCount?: number;
    },
  ) {
    await this.assertAny(actor, ["BOOKINGS_MANAGE", "FARE_LOCK"]);
    const passengerName = assertName(input.passengerName);
    const phone = normalizePhone(input.passengerPhone);
    if (!phone) throw new OperationsError("PHONE");
    const pickupLatitude = normalizeCoordinate(input.pickupLatitude, "lat");
    const pickupLongitude = normalizeCoordinate(input.pickupLongitude, "lng");
    if (!pickupLatitude || !pickupLongitude) throw new OperationsError("COORDINATES");
    const fareAmount = normalizeFare(input.fareAmount);
    if (!fareAmount) throw new OperationsError("FARE");
    const fareCurrency = PLATFORM_CURRENCY;
    const returnFare = input.direction === "ROUND_TRIP" ? normalizeFare(input.returnFareAmount ?? "") : fareAmount;
    if (!returnFare) throw new OperationsError("FARE");
    const seatCount = assertSeatCount(input.seatCount ?? 1);
    const selections =
      input.direction === "ROUND_TRIP"
        ? [
            { id: input.outboundTripId, expected: "OUTBOUND" as const, fare: fareAmount, pickupFromDestination: false },
            { id: input.returnTripId, expected: "RETURN" as const, fare: returnFare, pickupFromDestination: true },
          ]
        : [
            {
              id: input.tripId,
              expected: input.direction,
              fare: fareAmount,
              pickupFromDestination: false,
            },
          ];
    if (selections.some((item) => !item.id) || new Set(selections.map((item) => item.id)).size !== selections.length) {
      throw new OperationsError("LEG");
    }
    const loaded = await Promise.all(selections.map((selection) => this.bookableTrip(selection.id ?? "", selection.expected, seatCount)));
    const outbound = loaded[0];
    if (!outbound) throw new OperationsError("LEG");
    const pickupNote = input.pickupNote?.trim() || null;
    const codes = loaded.map(() => String(randomInt(0, 10000)).padStart(4, "0"));
    const created = await this.withReference("FV", async (reference, tx) => {
      const contact = await tx.passengerContact.upsert({
        where: { phone },
        update: { fullName: passengerName },
        create: { fullName: passengerName, phone, createdById: actor.id },
      });
      for (const trip of loaded) {
        const taken = await tx.tripPassenger.findFirst({ where: { tripId: trip.id, passengerContactId: contact.id } });
        if (taken) throw new OperationsError("SEAT");
        const occupied = await occupiedSeats(tx, trip.id);
        if (trip.seatCapacity > 0 && occupied + seatCount > trip.seatCapacity) throw new OperationsError("CAPACITY");
      }
      const booking = await tx.booking.create({
        data: {
          reference,
          passengerContactId: contact.id,
          direction: input.direction,
          status: "CONFIRMED",
          pickupLabel: pickupNote || "موقع على الخريطة",
          pickupLatitude,
          pickupLongitude,
          dropoffLabel: loaded.map((trip) => trip.destination.name).join(" / "),
          scheduledAt: outbound.scheduledAt,
          fareAmount,
          fareCurrency,
          fareLockedAt: new Date(),
          notes: input.notes?.trim() || null,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      for (const [index, trip] of loaded.entries()) {
        const fromDestination = selections[index]?.pickupFromDestination && outbound;
        await tx.tripPassenger.create({
          data: {
            tripId: trip.id,
            bookingId: booking.id,
            passengerContactId: contact.id,
            boardingStatus: "EXPECTED",
            pickupLatitude: fromDestination ? outbound.destination.latitude : pickupLatitude,
            pickupLongitude: fromDestination ? outbound.destination.longitude : pickupLongitude,
            pickupNote,
            fareAmount: selections[index]?.fare,
            fareCurrency,
            fareLockedAt: new Date(),
            seatCount,
            verificationCodeHash: hashCode(codes[index] ?? ""),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "booking.created",
          entityType: "Booking",
          entityId: booking.id,
          after: { reference, direction: input.direction, tripIds: loaded.map((trip) => trip.id), fareCurrency, phone },
        },
      });
      for (const trip of loaded) await this.refreshPickupTimes(tx, trip.id);
      return tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: bookingInclude });
    });
    return {
      ...toBookingView(created),
      boardingCodes: loaded.map((trip, index) => ({
        tripId: trip.id,
        direction: String(trip.direction),
        boardingCode: codes[index] ?? "",
      })),
    };
  }

  async listPublicTrips(): Promise<{
    items: {
      id: string;
      reference: string;
      direction: string;
      destinationName: string;
      scheduledAt: string;
      arrivesAt: string;
      isDaily: boolean;
      seatsRemaining: number | null;
    }[];
  }> {
    const trips = await this.prisma.client.trip.findMany({
      where: {
        parentTripId: null,
        direction: { in: ["OUTBOUND", "RETURN"] as const },
        status: { in: ["PENDING_ASSIGNMENT", "OFFERED", "ASSIGNED", "DRIVER_ARRIVED"] as const },
      },
      include: {
        destination: { select: { name: true } },
        vehicles: { where: { disabledAt: null }, select: { vehicle: { select: { capacity: true } } } },
        passengers: { where: { boardingStatus: { not: "CANCELLED" } }, select: { seatCount: true } },
      },
      orderBy: [{ scheduledAt: "asc" }, { reference: "asc" }],
      take: 50,
    });
    return {
      items: trips.flatMap((trip) => {
        const capacity = trip.vehicles.reduce((sum, link) => sum + link.vehicle.capacity, 0);
        const taken = trip.passengers.reduce((sum, seat) => sum + seat.seatCount, 0);
        const seatsRemaining = capacity > 0 ? capacity - taken : null;
        if (seatsRemaining !== null && seatsRemaining < 1) return [];
        return [
          {
            id: trip.id,
            reference: trip.reference,
            direction: String(trip.direction),
            destinationName: trip.destination.name,
            scheduledAt: trip.scheduledAt.toISOString(),
            arrivesAt: trip.arrivesAt.toISOString(),
            isDaily: trip.isDaily,
            seatsRemaining,
          },
        ];
      }),
    };
  }

  async requestPublicBooking(input: {
    passengerName: string;
    passengerPhone: string;
    tripId: string;
    seatCount: number;
    pickupLatitude: string;
    pickupLongitude: string;
    pickupNote?: string;
  }): Promise<{ reference: string; status: string; seatCount: number; destinationName: string; message: string }> {
    const passengerName = assertName(input.passengerName);
    const phone = normalizePhone(input.passengerPhone);
    if (!phone) throw new OperationsError("PHONE");
    const seatCount = assertSeatCount(input.seatCount);
    const pickupLatitude = normalizeCoordinate(input.pickupLatitude, "lat");
    const pickupLongitude = normalizeCoordinate(input.pickupLongitude, "lng");
    if (!pickupLatitude || !pickupLongitude) throw new OperationsError("COORDINATES");
    const chosen = await this.prisma.client.trip.findUnique({ where: { id: input.tripId }, select: { direction: true } });
    if (!chosen || (chosen.direction !== "OUTBOUND" && chosen.direction !== "RETURN")) throw new OperationsError("LEG");
    const trip = await this.bookableTrip(input.tripId, chosen.direction, seatCount);
    const pickupNote = input.pickupNote?.trim() || null;
    const created = await this.withReference("FV", async (reference, tx) => {
      const contact = await tx.passengerContact.upsert({
        where: { phone },
        update: { fullName: passengerName },
        create: { fullName: passengerName, phone },
      });
      const taken = await tx.tripPassenger.findFirst({ where: { tripId: trip.id, passengerContactId: contact.id } });
      if (taken) throw new OperationsError("SEAT");
      const occupied = await occupiedSeats(tx, trip.id);
      if (trip.seatCapacity > 0 && occupied + seatCount > trip.seatCapacity) throw new OperationsError("CAPACITY");
      const booking = await tx.booking.create({
        data: {
          reference,
          passengerContactId: contact.id,
          direction: trip.direction,
          status: "PENDING",
          pickupLabel: pickupNote || "موقع على الخريطة",
          pickupLatitude,
          pickupLongitude,
          dropoffLabel: trip.destination.name,
          scheduledAt: trip.scheduledAt,
          notes: "طلب حجز من الرابط العام. الأجرة بانتظار الكونترول.",
        },
      });
      await tx.tripPassenger.create({
        data: {
          tripId: trip.id,
          bookingId: booking.id,
          passengerContactId: contact.id,
          boardingStatus: "EXPECTED",
          pickupLatitude,
          pickupLongitude,
          pickupNote,
          seatCount,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "booking.requested",
          entityType: "Booking",
          entityId: booking.id,
          after: { reference, tripId: trip.id, seatCount, phone },
        },
      });
      return tx.booking.findUniqueOrThrow({ where: { id: booking.id }, include: bookingInclude });
    });
    return {
      reference: created.reference,
      status: String(created.status),
      seatCount,
      destinationName: trip.destination.name,
      message: "وصل طلبك. الكونترول يثبّت الأجرة ثم يؤكد الحجز. الأجرة تُدفع نقدًا للسائق بعد التأكيد.",
    };
  }

  async confirmBooking(actor: PublicUser, id: string, fareAmountRaw: string) {
    await this.assertAny(actor, ["BOOKINGS_MANAGE", "FARE_LOCK"]);
    const fareAmount = normalizeFare(fareAmountRaw);
    if (!fareAmount) throw new OperationsError("FARE");
    const existing = await this.prisma.client.booking.findUnique({
      where: { id },
      include: { passengers: { include: { trip: true } } },
    });
    if (!existing) throw new OperationsError("NOT_FOUND");
    if (existing.status !== "PENDING") throw new OperationsError("STATE", "التأكيد يخص الطلبات التي لم تُثبَّت أجرتها.");
    if (existing.passengers.length === 0) throw new OperationsError("STATE");
    const codes = existing.passengers.map(() => String(randomInt(0, 10000)).padStart(4, "0"));
    const updated = await this.prisma.client.$transaction(async (tx) => {
      for (const [index, seat] of existing.passengers.entries()) {
        await tx.tripPassenger.update({
          where: { id: seat.id },
          data: {
            fareAmount,
            fareCurrency: PLATFORM_CURRENCY,
            fareLockedAt: new Date(),
            verificationCodeHash: hashCode(codes[index] ?? ""),
          },
        });
      }
      const booking = await tx.booking.update({
        where: { id },
        data: {
          status: "CONFIRMED",
          fareAmount,
          fareCurrency: PLATFORM_CURRENCY,
          fareLockedAt: new Date(),
          updatedById: actor.id,
        },
        include: bookingInclude,
      });
      for (const seat of existing.passengers) await this.refreshPickupTimes(tx, seat.tripId);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "booking.confirmed",
          entityType: "Booking",
          entityId: id,
          before: { status: "PENDING" },
          after: { status: "CONFIRMED", fareAmount, fareCurrency: PLATFORM_CURRENCY },
        },
      });
      return booking;
    });
    return {
      ...toBookingView(updated),
      boardingCodes: existing.passengers.map((seat, index) => ({
        tripId: seat.tripId,
        direction: String(seat.trip.direction),
        boardingCode: codes[index] ?? "",
      })),
    };
  }

  async adjustFare(actor: PublicUser, id: string, tripId: string, fareAmountRaw: string, reason: string) {
    await this.assertAny(actor, ["FARE_ADJUST"]);
    const cleanReason = assertReason(reason);
    const fareAmount = normalizeFare(fareAmountRaw);
    if (!fareAmount) throw new OperationsError("FARE");
    const fareCurrency = PLATFORM_CURRENCY;
    const seat = await this.prisma.client.tripPassenger.findFirst({
      where: { bookingId: id, tripId },
      include: { trip: true, booking: true },
    });
    if (!seat) throw new OperationsError("NOT_FOUND");
    if (seat.booking.status === "CANCELLED" || ["CANCELLED", "NO_SHOW"].includes(seat.trip.status)) {
      throw new OperationsError("STATE");
    }
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await tx.tripPassenger.update({
        where: { id: seat.id },
        data: { fareAmount, fareCurrency, fareLockedAt: seat.fareLockedAt ?? new Date() },
      });
      const booking = await tx.booking.update({
        where: { id },
        data: { updatedById: actor.id },
        include: bookingInclude,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "booking.fare_adjusted",
          entityType: "Booking",
          entityId: id,
          reason: cleanReason,
          before: { tripId, fareAmount: formatStoredFare(seat.fareAmount), fareCurrency: seat.fareCurrency },
          after: { tripId, fareAmount, fareCurrency },
        },
      });
      return booking;
    });
    return toBookingView(updated);
  }

  async cancelBooking(actor: PublicUser, id: string, reason: string) {
    await this.assertAny(actor, ["BOOKINGS_MANAGE"]);
    const cleanReason = assertReason(reason);
    const existing = await this.prisma.client.booking.findUnique({
      where: { id },
      include: { passengers: { include: { trip: true } } },
    });
    if (!existing) throw new OperationsError("NOT_FOUND");
    if (existing.status === "CANCELLED") throw new OperationsError("STATE");
    if (existing.passengers.some((seat) => ["IN_PROGRESS", "COMPLETED", "DISPUTED"].includes(seat.trip.status))) {
      throw new OperationsError("TRANSITION");
    }
    const now = new Date();
    const updated = await this.prisma.client.$transaction(async (tx) => {
      for (const seat of existing.passengers) {
        if (seat.boardingStatus === "CANCELLED") continue;
        await tx.tripPassenger.update({ where: { id: seat.id }, data: { boardingStatus: "CANCELLED" } });
        await tx.boardingEvent.create({
          data: {
            tripPassengerId: seat.id,
            status: "CANCELLED",
            occurredAt: now,
            source: "CONTROL",
            actorId: actor.id,
          },
        });
      }
      for (const tripId of new Set(existing.passengers.map((seat) => seat.tripId))) {
        await this.refreshPickupTimes(tx, tripId);
      }
      const booking = await tx.booking.update({
        where: { id },
        data: { status: "CANCELLED", cancelReason: cleanReason, cancelledAt: now, updatedById: actor.id },
        include: bookingInclude,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "booking.cancelled",
          entityType: "Booking",
          entityId: id,
          reason: cleanReason,
          before: { status: existing.status },
          after: { status: "CANCELLED" },
        },
      });
      return booking;
    });
    return toBookingView(updated);
  }

  async listTrips(
    actor: PublicUser,
    query: {
      page: number;
      pageSize: number;
      search?: string;
      sort?: string;
      direction?: "asc" | "desc";
      leg?: "OUTBOUND" | "RETURN";
      bookable?: boolean;
      driverId?: string;
    },
  ) {
    const access = await this.tripAccess(actor);
    const term = query.search?.trim();
    const driverId = access.driverId;
    const filters = [];
    if (!access.seeAll && driverId) {
      filters.push({
        OR: [driverOperationalTrips(driverId), { offers: { some: { driverProfileId: driverId, status: "PENDING" as const } } }],
      });
    }
    if (access.seeAll && query.driverId) {
      filters.push(driverOperationalTrips(query.driverId));
    } else if (access.seeAll || query.bookable) {
      filters.push({ parentTripId: null });
    }
    if (term) {
      filters.push({
        OR: [
          { reference: { contains: term, mode: "insensitive" as const } },
          { destination: { name: { contains: term, mode: "insensitive" as const } } },
        ],
      });
    }
    const where = {
      ...(query.leg ? { direction: query.leg } : {}),
      ...(query.bookable ? { status: { in: [...BOOKABLE] as TripStatusName[] } } : {}),
      ...(filters.length > 0 ? { AND: filters } : {}),
    };
    const direction = query.direction === "asc" ? ("asc" as const) : ("desc" as const);
    const orderBy = query.sort === "status" ? { status: direction } : { scheduledAt: direction };
    const [total, rows] = await Promise.all([
      this.prisma.client.trip.count({ where }),
      this.prisma.client.trip.findMany({
        where,
        include: tripInclude,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => toTripView(row, access)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getTrip(actor: PublicUser, tripId: string) {
    const access = await this.tripAccess(actor);
    const trip = await this.prisma.client.trip.findUnique({ where: { id: tripId }, include: tripInclude });
    if (!trip) throw new OperationsError("NOT_FOUND");
    const owns = linkedToDriver(trip, access.driverId);
    const offered = access.driverId !== null && trip.offers.some((offer) => offer.driverProfileId === access.driverId && offer.status === "PENDING");
    if (!access.seeAll && !owns && !offered) throw new OperationsError("NOT_FOUND");
    const runs = trip.parentTripId
      ? []
      : await this.prisma.client.trip.findMany({
          where: { parentTripId: tripId },
          include: tripInclude,
          orderBy: { scheduledAt: "desc" },
        });
    return { ...toTripView(trip, access), runs: runs.map((row) => toTripView(row, access)) };
  }

  async candidates(actor: PublicUser) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const rows = await this.prisma.client.driverProfile.findMany({
      where: { deletedAt: null, approvalStatus: "APPROVED", assignmentBlocked: false, user: { status: "ACTIVE" } },
      include: {
        user: { select: { displayName: true } },
        vehicleAssignments: {
          where: { activeTo: null, vehicle: { approvalStatus: "APPROVED", deletedAt: null } },
          include: { vehicle: true },
          orderBy: [{ isPrimary: "desc" }, { activeFrom: "desc" }],
          take: 1,
        },
      },
      orderBy: { user: { displayName: "asc" } },
      take: 100,
    });
    return {
      items: rows.flatMap((row) => {
        const vehicle = row.vehicleAssignments[0]?.vehicle;
        if (!vehicle) return [];
        return [{ id: row.id, displayName: row.user.displayName, plateNumber: vehicle.plateNumber, vehicleId: vehicle.id }];
      }),
    };
  }

  async createTrip(
    actor: PublicUser,
    input: {
      direction: "OUTBOUND" | "RETURN";
      destinationId: string;
      scheduledAt: string;
      arrivesAt: string;
      isDaily?: boolean;
      notes?: string;
    },
  ) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const destination = await this.prisma.client.destination.findUnique({ where: { id: input.destinationId } });
    if (!destination || !destination.isActive) throw new OperationsError("DESTINATION");
    const scheduledAt = parseWhen(input.scheduledAt);
    const arrivesAt = parseWhen(input.arrivesAt);
    if (arrivesAt.getTime() <= scheduledAt.getTime()) throw new OperationsError("TIME");
    const created = await this.withReference("TR", async (reference, tx) => {
      const trip = await tx.trip.create({
        data: {
          reference,
          destinationId: destination.id,
          direction: input.direction,
          scheduledAt,
          arrivesAt,
          isDaily: input.isDaily !== false,
          notes: input.notes?.trim() || null,
          status: "PENDING_ASSIGNMENT",
        },
        include: tripInclude,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "trip.created",
          entityType: "Trip",
          entityId: trip.id,
          after: { reference, direction: input.direction, destinationId: destination.id },
        },
      });
      return trip;
    });
    return toTripView(created, { seeAll: true, driverId: null, userId: actor.id });
  }

  async updateTrip(
    actor: PublicUser,
    tripId: string,
    input: {
      direction: "OUTBOUND" | "RETURN";
      destinationId: string;
      scheduledAt: string;
      arrivesAt: string;
      isDaily?: boolean;
      notes?: string;
    },
  ) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const trip = await this.requireTrip(tripId);
    if (["IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED"].includes(trip.status)) {
      throw new OperationsError("STATE", "لا يمكن تعديل رحلة بدأت أو أُغلقت.");
    }
    const destination = await this.prisma.client.destination.findUnique({ where: { id: input.destinationId } });
    if (!destination || !destination.isActive) throw new OperationsError("DESTINATION");
    const scheduledAt = parseWhen(input.scheduledAt);
    const arrivesAt = parseWhen(input.arrivesAt);
    if (arrivesAt.getTime() <= scheduledAt.getTime()) throw new OperationsError("TIME");
    if (trip.parentTripId && input.isDaily !== false) {
      throw new OperationsError("STATE", "الرحلة الفرعية مرة واحدة ولا تتجدد.");
    }
    if (input.direction !== trip.direction) {
      const active = await this.prisma.client.tripPassenger.count({
        where: { tripId, boardingStatus: { not: "CANCELLED" } },
      });
      if (active > 0) throw new OperationsError("STATE", "لا يمكن تغيير اتجاه رحلة فيها ركاب.");
    }
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await tx.trip.update({
        where: { id: tripId },
        data: {
          direction: input.direction,
          destinationId: destination.id,
          scheduledAt,
          arrivesAt,
          isDaily: trip.parentTripId ? false : input.isDaily !== false,
          notes: input.notes?.trim() || null,
        },
      });
      await this.refreshPickupTimes(tx, tripId);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "trip.updated",
          entityType: "Trip",
          entityId: tripId,
          before: { direction: trip.direction, destinationId: trip.destinationId, scheduledAt: trip.scheduledAt, arrivesAt: trip.arrivesAt },
          after: { direction: input.direction, destinationId: destination.id, scheduledAt, arrivesAt },
        },
      });
      return tx.trip.findUniqueOrThrow({ where: { id: tripId }, include: tripInclude });
    });
    return toTripView(updated, { seeAll: true, driverId: null, userId: actor.id });
  }

  async setTripOrigin(actor: PublicUser, tripId: string, latitudeRaw: string, longitudeRaw: string) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const trip = await this.requireTrip(tripId);
    if (["COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED"].includes(trip.status)) throw new OperationsError("STATE");
    const latitude = normalizeCoordinate(latitudeRaw, "lat");
    const longitude = normalizeCoordinate(longitudeRaw, "lng");
    if (!latitude || !longitude) throw new OperationsError("COORDINATES");
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const saved = await tx.trip.update({
        where: { id: tripId },
        data: { originLatitude: latitude, originLongitude: longitude },
        include: tripInclude,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "trip.origin_set",
          entityType: "Trip",
          entityId: tripId,
          after: { latitude, longitude },
        },
      });
      return saved;
    });
    return toTripView(updated, { seeAll: true, driverId: null, userId: actor.id });
  }

  async tripRoute(actor: PublicUser, tripId: string) {
    const access = await this.tripAccess(actor);
    const trip = await this.prisma.client.trip.findUnique({ where: { id: tripId }, include: tripInclude });
    if (!trip) throw new OperationsError("NOT_FOUND");
    const owns = linkedToDriver(trip, access.driverId);
    const offered = access.driverId !== null && trip.offers.some((offer) => offer.driverProfileId === access.driverId && offer.status === "PENDING");
    if (!access.seeAll && !owns && !offered) throw new OperationsError("NOT_FOUND");
    if (!revealPassengerDetails({ seeAll: access.seeAll, assignedToViewer: owns })) {
      throw new OperationsError("FORBIDDEN", "مسار الركاب يظهر للسائق بعد الإسناد.");
    }
    if (trip.originLatitude === null || trip.originLongitude === null) throw new OperationsError("ORIGIN");
    const passengers = routeStopOrder(
      trip.passengers.filter(
        (passenger) =>
          passenger.boardingStatus !== "CANCELLED" &&
          passenger.pickupLatitude !== null &&
          passenger.pickupLongitude !== null &&
          (access.seeAll || passenger.booking.status === "CONFIRMED"),
      ),
    );
    const stops = [
      { kind: "driver", label: "موقع السائق", latitude: trip.originLatitude.toString(), longitude: trip.originLongitude.toString() },
      ...passengers.map((passenger) => ({
        kind: "pickup",
        label: passenger.passengerContact.fullName,
        latitude: passenger.pickupLatitude?.toString() ?? "",
        longitude: passenger.pickupLongitude?.toString() ?? "",
      })),
      {
        kind: "destination",
        label: trip.destination.name,
        latitude: trip.destination.latitude.toString(),
        longitude: trip.destination.longitude.toString(),
      },
    ];
    try {
      const path = await this.routes.route(stops.map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude })));
      return {
        distanceMeters: Math.round(path.distanceMeters),
        durationSeconds: Math.round(path.durationSeconds),
        provider: path.provider,
        coordinates: path.coordinates,
        stops,
      };
    } catch (error) {
      if (isRouteProviderNotConfigured(error)) throw new OperationsError("ROUTE", "مزود الطرق غير مفعّل.");
      if (error instanceof OsrmRouteError && error.reason === "noroute") {
        throw new OperationsError("ROUTE", "لا يوجد طريق بين موقع السائق والركاب والوجهة.");
      }
      throw new OperationsError("ROUTE");
    }
  }

  async driverMap(actor: PublicUser, latitudeRaw: string, longitudeRaw: string): Promise<DriverMapResult> {
    const access = await this.tripAccess(actor);
    if (!access.driverId) throw new OperationsError("FORBIDDEN", "خريطة المسار متاحة لحساب السائق.");
    const latitude = coordinateForRoute(latitudeRaw, "lat");
    const longitude = coordinateForRoute(longitudeRaw, "lng");
    if (!latitude || !longitude) throw new OperationsError("COORDINATES", "موقع السائق غير صالح.");

    const rows = await this.prisma.client.trip.findMany({
      where: {
        status: { in: ["DRIVER_ARRIVED", "IN_PROGRESS", "ASSIGNED"] },
        AND: [driverOperationalTrips(access.driverId)],
      },
      include: tripInclude,
      orderBy: { scheduledAt: "asc" },
      take: 30,
    });
    const selected = selectDriverTrip(rows);
    if (!selected) return { phase: "none" as const, trip: null };

    const trip = selected.trip;
    const expected = trip.passengers.filter((passenger) => passenger.boardingStatus === "EXPECTED" && passenger.booking.status === "CONFIRMED");
    const located = expected.filter((passenger) => passenger.pickupLatitude !== null && passenger.pickupLongitude !== null);
    const unlocatedPassengers = expected
      .filter((passenger) => passenger.pickupLatitude === null || passenger.pickupLongitude === null)
      .map((passenger) => passenger.passengerContact.fullName);
    const destination = {
      kind: "destination" as const,
      label: trip.destination.name,
      latitude: trip.destination.latitude.toString(),
      longitude: trip.destination.longitude.toString(),
      phone: null,
      note: trip.destination.addressNote,
      passengerId: null,
      fareAmount: null,
      fareCurrency: null,
      farePaidToCompany: false,
    };
    const driverStop = {
      kind: "driver" as const,
      label: "موقعك",
      latitude,
      longitude,
      phone: null,
      note: null,
      passengerId: null,
      fareAmount: null,
      fareCurrency: null,
      farePaidToCompany: false,
    };

    let ordered = located;
    const pickupPoints = located.flatMap((passenger) => {
      const pickupLatitude = passenger.pickupLatitude?.toString();
      const pickupLongitude = passenger.pickupLongitude?.toString();
      if (!pickupLatitude || !pickupLongitude) return [];
      return [{ latitude: pickupLatitude, longitude: pickupLongitude, passenger }];
    });
    try {
      if (pickupPoints.length > 0) {
        const matrix = await this.routes.distanceMatrix([
          { latitude, longitude },
          ...pickupPoints.map((point) => ({ latitude: point.latitude, longitude: point.longitude })),
        ]);
        const indexes = nearestPassengerOrder(matrix, pickupPoints.length);
        if (indexes.length !== pickupPoints.length) {
          throw new OperationsError("ROUTE", "لا يوجد طريق لجمع الركاب بالترتيب الأقرب.");
        }
        ordered = indexes.flatMap((index) => {
          const point = pickupPoints[index];
          return point ? [point.passenger] : [];
        });
      }
      const pickupStops = ordered.flatMap((passenger) => {
        const pickupLatitude = passenger.pickupLatitude?.toString();
        const pickupLongitude = passenger.pickupLongitude?.toString();
        if (!pickupLatitude || !pickupLongitude) return [];
        return [
          {
            kind: "pickup" as const,
            label: passenger.passengerContact.fullName,
            latitude: pickupLatitude,
            longitude: pickupLongitude,
            phone: passenger.passengerContact.phone,
            note: passenger.pickupNote,
            passengerId: passenger.id,
            fareAmount: formatStoredFare(passenger.fareAmount),
            fareCurrency: passenger.fareCurrency,
            farePaidToCompany: passenger.farePaidToCompany,
          },
        ];
      });
      const stops = [driverStop, ...pickupStops, destination];
      const path = await this.routes.route(stops.map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude })));
      return {
        phase: selected.phase,
        trip: {
          id: trip.id,
          reference: trip.reference,
          direction: trip.direction,
          status: trip.status,
          scheduledAt: trip.scheduledAt.toISOString(),
          arrivesAt: trip.arrivesAt.toISOString(),
          plannedDepartureAt: serviceDepartsAt(trip, new Date()).toISOString(),
          plannedArrivalAt: serviceArrivesAt(trip, new Date()).toISOString(),
          startedAt: trip.startedAt?.toISOString() ?? null,
          arrivalState: arrivalState(trip, new Date()),
          destinationName: trip.destination.name,
          distanceMeters: Math.round(path.distanceMeters),
          durationSeconds: Math.round(path.durationSeconds),
          provider: path.provider,
          coordinates: path.coordinates,
          legs: alignRouteLegs(path, stops),
          stops: stops.map((stop, index) => ({ ...stop, order: index + 1 })),
          unlocatedPassengers,
          breakdownReportedAt: trip.breakdownReportedAt?.toISOString() ?? null,
          breakdownNote: trip.breakdownNote,
        },
      };
    } catch (error) {
      if (error instanceof OperationsError) throw error;
      if (isRouteProviderNotConfigured(error)) throw new OperationsError("ROUTE", "مزود الطرق غير مفعّل.");
      if (error instanceof OsrmRouteError && error.reason === "noroute") {
        throw new OperationsError("ROUTE", "لا يوجد طريق بين موقعك والركاب والوجهة.");
      }
      throw new OperationsError("ROUTE");
    }
  }

  async listDestinations(actor: PublicUser) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const items = await this.prisma.client.destination.findMany({ orderBy: { name: "asc" } });
    return { items: items.map(toDestinationView) };
  }

  async createDestination(
    actor: PublicUser,
    input: { name: string; latitude: string; longitude: string; addressNote?: string; notes?: string; isActive?: boolean },
  ) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const saved = await this.prisma.client.destination.create({ data: destinationData(input) });
    await this.prisma.client.auditLog.create({
      data: {
        actorId: actor.id,
        action: "destination.created",
        entityType: "Destination",
        entityId: saved.id,
        after: { name: saved.name },
      },
    });
    return toDestinationView(saved);
  }

  async updateDestination(
    actor: PublicUser,
    id: string,
    input: { name: string; latitude: string; longitude: string; addressNote?: string; notes?: string; isActive?: boolean },
  ) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const existing = await this.prisma.client.destination.findUnique({ where: { id } });
    if (!existing) throw new OperationsError("NOT_FOUND");
    const saved = await this.prisma.client.destination.update({ where: { id }, data: destinationData(input, existing.isActive) });
    await this.prisma.client.auditLog.create({
      data: {
        actorId: actor.id,
        action: "destination.updated",
        entityType: "Destination",
        entityId: id,
        before: { name: existing.name, isActive: existing.isActive },
        after: { name: saved.name, isActive: saved.isActive },
      },
    });
    return toDestinationView(saved);
  }

  async assignTrip(actor: PublicUser, tripId: string, driverProfileId: string) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const trip = await this.requireTrip(tripId);
    if (!canTransitionTrip(trip.status as TripStatusName, "ASSIGNED")) throw new OperationsError("TRANSITION");
    const driver = await this.readyDriver(driverProfileId);
    const now = new Date();
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await this.guardCredit(tx, driver.id, tripId);
      await tx.tripOffer.updateMany({
        where: { tripId, status: "PENDING" },
        data: { status: "CANCELLED", respondedAt: now },
      });
      await tx.tripVehicle.upsert({
        where: { tripId_vehicleId: { tripId, vehicleId: driver.vehicleId } },
        create: { tripId, vehicleId: driver.vehicleId, driverProfileId: driver.id },
        update: { driverProfileId: driver.id, disabledAt: null, disableReason: null },
      });
      const saved = await tx.trip.update({
        where: { id: tripId },
        data: {
          status: "ASSIGNED",
          driverProfileId: driver.id,
          vehicleId: driver.vehicleId,
          assignmentSource: "MANUAL_DISPATCH",
          assignedAt: now,
        },
        include: tripInclude,
      });
      await tx.tripEvent.create({
        data: {
          tripId,
          type: "ASSIGNMENT_CHANGED",
          source: "CONTROL",
          actorId: actor.id,
          occurredAt: now,
          payload: { driverProfileId: driver.id, vehicleId: driver.vehicleId, source: "MANUAL_DISPATCH" },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "trip.assigned",
          entityType: "Trip",
          entityId: tripId,
          after: { driverProfileId: driver.id, vehicleId: driver.vehicleId },
        },
      });
      return saved;
    });
    return toTripView(updated, { seeAll: true, driverId: null, userId: actor.id });
  }

  async linkVehicle(actor: PublicUser, tripId: string, driverProfileId: string) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const trip = await this.requireTrip(tripId);
    if (["IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED"].includes(trip.status)) {
      throw new OperationsError("STATE", "لا يمكن ربط مركبة بعد بدء الرحلة.");
    }
    const driver = await this.readyDriver(driverProfileId);
    if (trip.parentTripId && trip.vehicles.some((link) => !link.disabledAt && link.vehicleId !== driver.vehicleId)) {
      throw new OperationsError("STATE", "الرحلة الفرعية لمركبة واحدة فقط ولا تتجدد.");
    }
    const existing = trip.vehicles.find((link) => link.vehicleId === driver.vehicleId);
    if (existing && !existing.disabledAt) {
      throw new OperationsError("STATE", "هذه المركبة مرتبطة بالرحلة مسبقًا.");
    }
    const active = trip.vehicles.filter((link) => !link.disabledAt);
    if (!trip.vehicleId || active.length === 0) return this.assignTrip(actor, tripId, driverProfileId);
    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (existing) {
        await tx.tripVehicle.update({
          where: { id: existing.id },
          data: { driverProfileId: driver.id, disabledAt: null, disableReason: null },
        });
      } else {
        await tx.tripVehicle.create({
          data: { tripId, vehicleId: driver.vehicleId, driverProfileId: driver.id },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "trip.vehicle_linked",
          entityType: "Trip",
          entityId: tripId,
          after: { driverProfileId: driver.id, vehicleId: driver.vehicleId },
        },
      });
      return tx.trip.findUniqueOrThrow({ where: { id: tripId }, include: tripInclude });
    });
    return toTripView(updated, { seeAll: true, driverId: null, userId: actor.id });
  }

  async unlinkVehicle(actor: PublicUser, tripId: string, vehicleId: string) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const trip = await this.prisma.client.trip.findUnique({
      where: { id: tripId },
      include: { vehicles: { include: { vehicle: { select: { id: true, capacity: true } } } } },
    });
    if (!trip) throw new OperationsError("NOT_FOUND");
    if (["IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED"].includes(trip.status)) {
      throw new OperationsError("STATE", "لا يمكن فك المركبة بعد بدء الرحلة.");
    }
    const activeLinks = trip.vehicles.filter((item) => !item.disabledAt);
    const link = activeLinks.find((item) => item.vehicleId === vehicleId);
    if (!link) throw new OperationsError("NOT_FOUND");
    const remaining = activeLinks.filter((item) => item.vehicleId !== vehicleId);
    const active = await occupiedSeats(this.prisma.client, tripId);
    const seats = remaining.reduce((sum, item) => sum + item.vehicle.capacity, 0);
    if (active > 0 && seats < active) {
      throw new OperationsError(
        "CAPACITY",
        remaining.length === 0 ? "لا يمكن فك المركبة الأخيرة ويوجد ركاب. استبدلها بسائق آخر." : "المقاعد المتبقية لا تكفي للركاب الحاليين.",
      );
    }
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await tx.tripVehicle.delete({ where: { id: link.id } });
      if (trip.vehicleId === vehicleId || remaining.length === 0) {
        const next = remaining[0];
        if (next) await this.guardCredit(tx, next.driverProfileId, tripId);
        await tx.trip.update({
          where: { id: tripId },
          data: next
            ? {
                vehicleId: next.vehicleId,
                driverProfileId: next.driverProfileId,
                ...(trip.status === "DRIVER_ARRIVED" ? { status: "ASSIGNED" as const, driverArrivedAt: null } : {}),
              }
            : {
                vehicleId: null,
                driverProfileId: null,
                assignmentSource: null,
                assignedAt: null,
                driverArrivedAt: null,
                status: "PENDING_ASSIGNMENT",
              },
        });
        await tx.tripEvent.create({
          data: {
            tripId,
            type: "ASSIGNMENT_CHANGED",
            source: "CONTROL",
            actorId: actor.id,
            occurredAt: new Date(),
            payload: next
              ? { vehicleId: next.vehicleId, driverProfileId: next.driverProfileId, removedVehicleId: vehicleId }
              : { vehicleId: null, driverProfileId: null, removedVehicleId: vehicleId },
          },
        });
        if (!next) {
          await tx.tripOffer.updateMany({ where: { tripId, status: "PENDING" }, data: { status: "CANCELLED", respondedAt: new Date() } });
        }
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "trip.vehicle_unlinked",
          entityType: "Trip",
          entityId: tripId,
          before: { vehicleId },
          after: { vehicleId: remaining[0]?.vehicleId ?? null },
        },
      });
      return tx.trip.findUniqueOrThrow({ where: { id: tripId }, include: tripInclude });
    });
    return toTripView(updated, { seeAll: true, driverId: null, userId: actor.id });
  }

  async disableVehicle(actor: PublicUser, tripId: string, vehicleId: string, reason: string) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const cleanReason = assertReason(reason);
    const trip = await this.prisma.client.trip.findUnique({
      where: { id: tripId },
      include: { vehicles: { include: { vehicle: { select: { id: true, capacity: true } } } } },
    });
    if (!trip) throw new OperationsError("NOT_FOUND");
    if (["COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED"].includes(trip.status)) {
      throw new OperationsError("STATE", "لا يمكن تعطيل مركبة بعد إغلاق الرحلة.");
    }
    const activeLinks = trip.vehicles.filter((item) => !item.disabledAt);
    const link = activeLinks.find((item) => item.vehicleId === vehicleId);
    if (!link) throw new OperationsError("NOT_FOUND");
    const remaining = activeLinks.filter((item) => item.vehicleId !== vehicleId);
    if (remaining.length === 0) {
      throw new OperationsError("STATE", "لا يمكن تعطيل المركبة الوحيدة. الرحلة تبقى تعمل مع المركبات الأخرى، أو ألغِ الرحلة إذا توقفت بالكامل.");
    }
    const passengers = await occupiedSeats(this.prisma.client, tripId);
    const seats = remaining.reduce((sum, item) => sum + item.vehicle.capacity, 0);
    if (passengers > seats) throw new OperationsError("CAPACITY", "مقاعد المركبات المتبقية لا تكفي للركاب الحاليين.");
    const now = new Date();
    const next = remaining[0];
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await tx.tripVehicle.update({
        where: { id: link.id },
        data: { disabledAt: now, disableReason: cleanReason },
      });
      await tx.tripOffer.updateMany({
        where: { tripId, driverProfileId: link.driverProfileId, status: "PENDING" },
        data: { status: "CANCELLED", respondedAt: now },
      });
      if (trip.vehicleId === vehicleId && next) {
        await tx.trip.update({
          where: { id: tripId },
          data: { vehicleId: next.vehicleId, driverProfileId: next.driverProfileId },
        });
        await tx.tripEvent.create({
          data: {
            tripId,
            type: "ASSIGNMENT_CHANGED",
            source: "CONTROL",
            actorId: actor.id,
            occurredAt: now,
            payload: { vehicleId: next.vehicleId, driverProfileId: next.driverProfileId, disabledVehicleId: vehicleId },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "trip.vehicle_disabled",
          entityType: "Trip",
          entityId: tripId,
          reason: cleanReason,
          before: { vehicleId, driverProfileId: link.driverProfileId },
          after: { vehicleId: trip.vehicleId === vehicleId ? next?.vehicleId ?? null : trip.vehicleId, status: trip.status },
        },
      });
      return tx.trip.findUniqueOrThrow({ where: { id: tripId }, include: tripInclude });
    });
    return toTripView(updated, { seeAll: true, driverId: null, userId: actor.id });
  }

  async replaceVehicle(actor: PublicUser, tripId: string, vehicleId: string, driverProfileId: string) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const trip = await this.prisma.client.trip.findUnique({
      where: { id: tripId },
      include: { vehicles: { include: { vehicle: { select: { id: true, capacity: true } } } } },
    });
    if (!trip) throw new OperationsError("NOT_FOUND");
    if (["IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED"].includes(trip.status)) {
      throw new OperationsError("STATE", "لا يمكن تغيير السائق بعد بدء الرحلة.");
    }
    const link = trip.vehicles.find((item) => item.vehicleId === vehicleId);
    if (!link) throw new OperationsError("NOT_FOUND");
    const driver = await this.readyDriver(driverProfileId);
    if (trip.vehicles.some((item) => item.vehicleId === driver.vehicleId && item.vehicleId !== vehicleId)) {
      throw new OperationsError("STATE", "هذه المركبة مرتبطة بالرحلة مسبقًا.");
    }
    const active = await occupiedSeats(this.prisma.client, tripId);
    const seats = trip.vehicles.reduce((sum, item) => {
      if (item.disabledAt && item.vehicleId !== vehicleId) return sum;
      return sum + (item.vehicleId === vehicleId ? driver.capacity : item.vehicle.capacity);
    }, 0);
    if (active > seats) throw new OperationsError("CAPACITY", "مقاعد السائق البديل لا تكفي للركاب الحاليين.");
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await tx.tripVehicle.delete({ where: { id: link.id } });
      await tx.tripVehicle.create({
        data: { tripId, vehicleId: driver.vehicleId, driverProfileId: driver.id },
      });
      if (trip.vehicleId === vehicleId || !trip.vehicleId) {
        await this.guardCredit(tx, driver.id, tripId);
        await tx.trip.update({
          where: { id: tripId },
          data: {
            vehicleId: driver.vehicleId,
            driverProfileId: driver.id,
            ...(trip.status === "DRIVER_ARRIVED" ? { status: "ASSIGNED" as const, driverArrivedAt: null } : {}),
          },
        });
        await tx.tripEvent.create({
          data: {
            tripId,
            type: "ASSIGNMENT_CHANGED",
            source: "CONTROL",
            actorId: actor.id,
            occurredAt: new Date(),
            payload: { vehicleId: driver.vehicleId, driverProfileId: driver.id, replacedVehicleId: vehicleId },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "trip.vehicle_replaced",
          entityType: "Trip",
          entityId: tripId,
          before: { vehicleId, driverProfileId: link.driverProfileId },
          after: { vehicleId: driver.vehicleId, driverProfileId: driver.id },
        },
      });
      return tx.trip.findUniqueOrThrow({ where: { id: tripId }, include: tripInclude });
    });
    return toTripView(updated, { seeAll: true, driverId: null, userId: actor.id });
  }

  async deleteTrip(actor: PublicUser, tripId: string, reason: string) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const cleanReason = assertReason(reason);
    const trip = await this.prisma.client.trip.findUnique({
      where: { id: tripId },
      include: { commission: { select: { id: true } }, passengers: { select: { id: true, bookingId: true } } },
    });
    if (!trip) throw new OperationsError("NOT_FOUND");
    if (trip.commission) {
      throw new OperationsError("STATE", "لا يمكن حذف الرحلة لأن لها عمولة معتمدة.");
    }
    const runs = await this.prisma.client.trip.findMany({
      where: { parentTripId: tripId },
      select: {
        id: true,
        commission: { select: { id: true } },
        passengers: { select: { id: true, bookingId: true } },
      },
    });
    if (runs.some((run) => run.commission)) {
      throw new OperationsError("STATE", "لا يمكن حذف الرحلة لأن إحدى رحلاتها الفرعية لها عمولة معتمدة.");
    }
    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      for (const run of runs) {
        const runPassengerIds = run.passengers.map((seat) => seat.id);
        if (runPassengerIds.length > 0) {
          await tx.boardingEvent.deleteMany({ where: { tripPassengerId: { in: runPassengerIds } } });
          await tx.tripPassenger.deleteMany({ where: { tripId: run.id } });
        }
        await tx.tripOffer.deleteMany({ where: { tripId: run.id } });
        await tx.tripEvent.deleteMany({ where: { tripId: run.id } });
        await tx.tripVehicle.deleteMany({ where: { tripId: run.id } });
        await tx.trip.delete({ where: { id: run.id } });
      }
      const passengerIds = trip.passengers.map((seat) => seat.id);
      if (passengerIds.length > 0) {
        await tx.boardingEvent.deleteMany({ where: { tripPassengerId: { in: passengerIds } } });
        await tx.tripPassenger.deleteMany({ where: { tripId } });
      }
      const bookingIds = [...new Set([...trip.passengers, ...runs.flatMap((run) => run.passengers)].map((seat) => seat.bookingId))];
      for (const bookingId of bookingIds) {
        const remaining = await tx.tripPassenger.count({ where: { bookingId } });
        if (remaining === 0) {
          await tx.booking.update({
            where: { id: bookingId },
            data: { status: "CANCELLED", cancelReason: cleanReason, cancelledAt: now, updatedById: actor.id },
          });
        }
      }
      await tx.tripOffer.deleteMany({ where: { tripId } });
      await tx.tripEvent.deleteMany({ where: { tripId } });
      await tx.tripVehicle.deleteMany({ where: { tripId } });
      await tx.trip.delete({ where: { id: tripId } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "trip.deleted",
          entityType: "Trip",
          entityId: tripId,
          reason: cleanReason,
          before: { reference: trip.reference, status: trip.status },
        },
      });
    });
    return { deleted: true };
  }

  async previewRun(
    actor: PublicUser,
    tripId: string,
    input: { vehicleId: string; latitude: string; longitude: string; scheduledAt: string },
  ) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const parent = await this.requireRunParent(tripId);
    const link = parent.vehicles.find((item) => item.vehicleId === input.vehicleId && !item.disabledAt);
    if (!link) throw new OperationsError("NOT_FOUND", "هذه المركبة ليست مرتبطة بالرحلة.");
    const origin = parseOrigin(input.latitude, input.longitude);
    const when = parseWhen(input.scheduledAt);
    assertRunDay(when);
    const taken = await this.assignedBookingIds(parent.id, when);
    const located = parent.passengers.flatMap((passenger) => {
      if (passenger.boardingStatus === "CANCELLED" || passenger.booking.status !== "CONFIRMED") return [];
      return [
        {
          id: passenger.id,
          name: passenger.passengerContact.fullName,
          phone: passenger.passengerContact.phone,
          bookingId: passenger.bookingId,
          latitude: passenger.pickupLatitude === null ? null : Number(passenger.pickupLatitude.toString()),
          longitude: passenger.pickupLongitude === null ? null : Number(passenger.pickupLongitude.toString()),
          seatCount: passenger.seatCount,
        },
      ];
    });
    const ranked = rankByStraightLine(origin.latitude, origin.longitude, located);
    const open = ranked.filter((item) => !taken.has(item.passenger.bookingId));
    const suggested = new Set<string>();
    let suggestedSeats = 0;
    for (const item of open) {
      if (item.distanceMeters === null) continue;
      if (suggestedSeats + item.passenger.seatCount > link.vehicle.capacity) continue;
      suggested.add(item.passenger.id);
      suggestedSeats += item.passenger.seatCount;
    }
    return {
      vehicleId: link.vehicleId,
      driverName: link.driverProfile.user.displayName,
      plateNumber: link.vehicle.plateNumber,
      capacity: link.vehicle.capacity,
      suggestedIds: [...suggested],
      passengers: ranked.map((item) => ({
        id: item.passenger.id,
        name: item.passenger.name,
        phone: item.passenger.phone,
        distanceMeters: item.distanceMeters,
        suggested: suggested.has(item.passenger.id),
        assignedElsewhere: taken.has(item.passenger.bookingId),
      })),
    };
  }

  async confirmRun(
    actor: PublicUser,
    tripId: string,
    input: {
      vehicleId: string;
      passengerIds: string[];
      latitude: string;
      longitude: string;
      scheduledAt: string;
      arrivesAt: string;
    },
  ) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const parent = await this.requireRunParent(tripId);
    const link = parent.vehicles.find((item) => item.vehicleId === input.vehicleId && !item.disabledAt);
    if (!link) throw new OperationsError("NOT_FOUND", "هذه المركبة ليست مرتبطة بالرحلة.");
    const origin = parseOrigin(input.latitude, input.longitude);
    const scheduledAt = parseWhen(input.scheduledAt);
    const arrivesAt = parseWhen(input.arrivesAt);
    if (arrivesAt.getTime() <= scheduledAt.getTime()) throw new OperationsError("TIME");
    assertRunDay(scheduledAt);
    const passengerIds = [...new Set(input.passengerIds)];
    if (passengerIds.length === 0) throw new OperationsError("STATE", "اختر راكبًا واحدًا على الأقل.");
    const taken = await this.assignedBookingIds(parent.id, scheduledAt);
    const bounds = utcDayBounds(scheduledAt);
    const existing = await this.prisma.client.trip.findFirst({
      where: {
        parentTripId: parent.id,
        vehicleId: link.vehicleId,
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        scheduledAt: { gte: bounds.start, lt: bounds.end },
      },
      select: { id: true },
    });
    if (existing) throw new OperationsError("STATE", "هذه المركبة لها رحلة فرعية في هذا اليوم.");
    const seats = parent.passengers.filter(
      (passenger) => passengerIds.includes(passenger.id) && passenger.boardingStatus !== "CANCELLED" && passenger.booking.status === "CONFIRMED",
    );
    if (seats.length !== passengerIds.length) throw new OperationsError("NOT_FOUND", "أحد الركاب المختارين ليس على هذه الرحلة.");
    const reserved = seats.reduce((sum, seat) => sum + seat.seatCount, 0);
    if (reserved > link.vehicle.capacity) throw new OperationsError("CAPACITY", "عدد المقاعد يتجاوز مقاعد هذه المركبة.");
    if (seats.some((seat) => taken.has(seat.bookingId))) {
      throw new OperationsError("STATE", "أحد الركاب معيّن مسبقًا على مركبة أخرى في هذا اليوم.");
    }
    const created = await this.withReference("TR", async (reference, tx) => {
      const run = await tx.trip.create({
        data: {
          reference,
          parentTripId: parent.id,
          destinationId: parent.destinationId,
          direction: parent.direction,
          scheduledAt,
          arrivesAt,
          isDaily: false,
          originLatitude: origin.latitudeText,
          originLongitude: origin.longitudeText,
          notes: `رحلة فرعية لمرة واحدة من ${parent.reference}`,
          status: "ASSIGNED",
          driverProfileId: link.driverProfileId,
          vehicleId: link.vehicleId,
          assignmentSource: "MANUAL_DISPATCH",
          assignedAt: new Date(),
        },
      });
      await tx.tripVehicle.create({
        data: { tripId: run.id, vehicleId: link.vehicleId, driverProfileId: link.driverProfileId },
      });
      await tx.tripPassenger.createMany({
        data: seats.map((seat) => ({
          tripId: run.id,
          bookingId: seat.bookingId,
          passengerContactId: seat.passengerContactId,
          pickupLatitude: seat.pickupLatitude,
          pickupLongitude: seat.pickupLongitude,
          pickupNote: seat.pickupNote,
          fareAmount: seat.fareAmount,
          fareCurrency: seat.fareCurrency,
          fareLockedAt: seat.fareLockedAt,
          farePaidToCompany: seat.farePaidToCompany,
          seatCount: seat.seatCount,
          boardingStatus: "EXPECTED" as const,
          verificationCodeHash: seat.verificationCodeHash,
        })),
      });
      await this.refreshPickupTimes(tx, run.id);
      await tx.tripEvent.create({
        data: {
          tripId: run.id,
          type: "ASSIGNMENT_CHANGED",
          source: "CONTROL",
          actorId: actor.id,
          occurredAt: new Date(),
          payload: { parentTripId: parent.id, vehicleId: link.vehicleId, passengerCount: seats.length },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "trip.run_confirmed",
          entityType: "Trip",
          entityId: run.id,
          after: { parentTripId: parent.id, reference, vehicleId: link.vehicleId, passengerIds },
        },
      });
      return tx.trip.findUniqueOrThrow({ where: { id: run.id }, include: tripInclude });
    });
    return toTripView(created, { seeAll: true, driverId: null, userId: actor.id });
  }

  async offerTrip(
    actor: PublicUser,
    tripId: string,
    input: { driverProfileId: string; straightLineMeters?: number; serviceAreaId?: string },
  ) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const trip = await this.requireTrip(tripId);
    if (trip.status !== "PENDING_ASSIGNMENT" && trip.status !== "OFFERED") throw new OperationsError("STATE");
    const driver = await this.prisma.client.driverProfile.findUnique({
      where: { id: input.driverProfileId },
      include: {
        user: true,
        vehicleAssignments: {
          where: { activeTo: null },
          include: { vehicle: true },
          orderBy: [{ isPrimary: "desc" }, { activeFrom: "desc" }],
          take: 1,
        },
      },
    });
    if (!driver) throw new OperationsError("NOT_FOUND");
    const vehicle = driver.vehicleAssignments[0]?.vehicle;
    const area = await this.areaLink(driver.id, input.serviceAreaId ?? null);
    const decision = decideOffer({
      driverApproved: driver.deletedAt === null && driver.approvalStatus === "APPROVED" && driver.user.status === "ACTIVE",
      vehicleApproved: Boolean(vehicle && vehicle.deletedAt === null && vehicle.approvalStatus === "APPROVED"),
      assignmentBlocked: driver.assignmentBlocked,
      acceptsNearby: driver.acceptsNearbyRequests,
      nearbyRadiusMeters: driver.nearbyRadiusMeters,
      straightLineMeters: input.straightLineMeters ?? null,
      area,
    });
    if (!decision.allowed) throw new OperationsError("OFFER", decision.reason);
    const now = new Date();
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await tx.tripOffer.create({
        data: {
          tripId,
          driverProfileId: driver.id,
          source: decision.source,
          status: "PENDING",
          matchReason: decision.reason,
          straightLineMeters: input.straightLineMeters,
          expiresAt: new Date(now.getTime() + OFFER_TTL_MS),
        },
      });
      return tx.trip.update({
        where: { id: tripId },
        data: { status: "OFFERED" },
        include: tripInclude,
      });
    });
    return toTripView(updated, { seeAll: true, driverId: null, userId: actor.id });
  }

  async respondOffer(actor: PublicUser, offerId: string, decision: "ACCEPT" | "REJECT") {
    await this.assertAny(actor, ["TRIPS_OPERATE_OWN"]);
    const driver = await this.prisma.client.driverProfile.findUnique({ where: { userId: actor.id } });
    if (!driver) throw new OperationsError("FORBIDDEN");
    const offer = await this.prisma.client.tripOffer.findUnique({ where: { id: offerId }, include: { trip: true } });
    if (!offer || offer.driverProfileId !== driver.id) throw new OperationsError("NOT_FOUND");
    if (offer.status !== "PENDING" || (offer.expiresAt && offer.expiresAt.getTime() < Date.now())) {
      throw new OperationsError("STATE");
    }
    const now = new Date();
    if (decision === "REJECT") {
      await this.prisma.client.$transaction(async (tx) => {
        await tx.tripOffer.update({ where: { id: offerId }, data: { status: "REJECTED", respondedAt: now } });
        const pending = await tx.tripOffer.count({ where: { tripId: offer.tripId, status: "PENDING" } });
        if (pending === 0 && offer.trip.status === "OFFERED") {
          await tx.trip.update({ where: { id: offer.tripId }, data: { status: "PENDING_ASSIGNMENT" } });
        }
      });
      return { updated: true };
    }
    const ready = await this.readyDriver(driver.id);
    if (!canTransitionTrip(offer.trip.status as TripStatusName, "ASSIGNED")) throw new OperationsError("TRANSITION");
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await this.guardCredit(tx, ready.id, offer.tripId);
      await tx.tripOffer.update({ where: { id: offerId }, data: { status: "ACCEPTED", respondedAt: now } });
      await tx.tripOffer.updateMany({
        where: { tripId: offer.tripId, status: "PENDING", id: { not: offerId } },
        data: { status: "CANCELLED", respondedAt: now },
      });
      await tx.tripVehicle.upsert({
        where: { tripId_vehicleId: { tripId: offer.tripId, vehicleId: ready.vehicleId } },
        create: { tripId: offer.tripId, vehicleId: ready.vehicleId, driverProfileId: ready.id },
        update: { driverProfileId: ready.id, disabledAt: null, disableReason: null },
      });
      return tx.trip.update({
        where: { id: offer.tripId },
        data: {
          status: "ASSIGNED",
          driverProfileId: ready.id,
          vehicleId: ready.vehicleId,
          assignmentSource: offer.source,
          assignedAt: now,
        },
        include: tripInclude,
      });
    });
    return toTripView(updated, { seeAll: false, driverId: driver.id, userId: actor.id });
  }

  async changeStatus(
    actor: PublicUser,
    tripId: string,
    status: TripStatusName,
    reason?: string,
    occurredAt?: string,
    location?: { latitude?: string; longitude?: string },
  ) {
    const access = await this.tripAccess(actor);
    const trip = await this.requireTrip(tripId);
    const owns = linkedToDriver(trip, access.driverId);
    if (!access.seeAll && !owns) throw new OperationsError("NOT_FOUND");
    if (!access.seeAll && !DRIVER_STATUSES.has(status)) throw new OperationsError("FORBIDDEN");
    if (status === "COMPLETED" && !access.seeAll) this.assertInsideDestination(trip, location);
    if (status === "IN_PROGRESS" && !access.seeAll) {
      const claimed = occurredAt ? parseWhen(occurredAt) : new Date();
      if (!driverMayStartTrip(trip, new Date()) || !driverMayStartTrip(trip, claimed)) {
        throw new OperationsError("TIME", "يمكن بدء الرحلة قبل موعد الانطلاق بساعة واحدة كحد أقصى.");
      }
    }
    const stalled = arrivalState(trip, new Date()) === "STALLED";
    const brokenCancel = canCancelBrokenTrip({
      actorCanDispatch: access.seeAll,
      status: trip.status,
      breakdownReported: trip.breakdownReportedAt !== null,
      arrivalStalled: stalled,
    });
    if (!brokenCancel && !canTransitionTrip(trip.status as TripStatusName, status)) throw new OperationsError("TRANSITION");
    const cleanReason = status === "CANCELLED" || status === "DISPUTED" ? assertReason(reason ?? "") : reason?.trim() || null;
    const when = occurredAt ? parseWhen(occurredAt) : new Date();
    const updated = await this.prisma.client.$transaction(async (tx) => {
      if (status === "NO_SHOW") {
        const passengers = await tx.tripPassenger.findMany({ where: { tripId, boardingStatus: "EXPECTED" } });
        for (const passenger of passengers) {
          await tx.tripPassenger.update({ where: { id: passenger.id }, data: { boardingStatus: "NO_SHOW" } });
          await tx.boardingEvent.create({
            data: { tripPassengerId: passenger.id, status: "NO_SHOW", occurredAt: when, source: access.seeAll && !owns ? "CONTROL" : "DRIVER_APP", actorId: actor.id },
          });
        }
      }
      if (status === "CANCELLED") {
        await tx.tripOffer.updateMany({ where: { tripId, status: "PENDING" }, data: { status: "CANCELLED", respondedAt: when } });
        const seats = await tx.tripPassenger.findMany({ where: { tripId }, select: { id: true, bookingId: true } });
        for (const seat of seats) {
          await tx.tripPassenger.update({ where: { id: seat.id }, data: { boardingStatus: "CANCELLED" } });
        }
        const bookingIds = [...new Set(seats.map((seat) => seat.bookingId))];
        for (const bookingId of bookingIds) {
          const remaining = await tx.tripPassenger.count({ where: { bookingId, boardingStatus: { not: "CANCELLED" } } });
          if (remaining === 0) {
            await tx.booking.update({
              where: { id: bookingId },
              data: { status: "CANCELLED", cancelReason: cleanReason, cancelledAt: when, updatedById: actor.id },
            });
          }
        }
      }
      const saved = await tx.trip.update({
        where: { id: tripId },
        data: {
          status,
          ...(status === "DRIVER_ARRIVED" ? { driverArrivedAt: when } : {}),
          ...(status === "IN_PROGRESS" ? { startedAt: when } : {}),
          ...(status === "COMPLETED" || status === "NO_SHOW" || brokenCancel ? { endedAt: when } : {}),
        },
        include: tripInclude,
      });
      await tx.tripEvent.create({
        data: {
          tripId,
          type: "STATUS_CHANGED",
          source: access.seeAll && !owns ? "CONTROL" : "DRIVER_APP",
          actorId: actor.id,
          occurredAt: when,
          payload: { status, reason: cleanReason },
        },
      });
      if (status === "COMPLETED") await this.guardAccrual(tx, tripId, actor.id);
      return saved;
    });
    return toTripView(updated, access);
  }

  async reportBreakdown(actor: PublicUser, tripId: string, note?: string) {
    const access = await this.tripAccess(actor);
    if (!access.driverId) throw new OperationsError("FORBIDDEN", "بلاغ التعثر متاح لحساب السائق.");
    const trip = await this.requireTrip(tripId);
    if (!linkedToDriver(trip, access.driverId)) throw new OperationsError("NOT_FOUND");
    if (!["ASSIGNED", "DRIVER_ARRIVED", "IN_PROGRESS"].includes(trip.status)) {
      throw new OperationsError("STATE", "يمكن إبلاغ التعثر أثناء الرحلة المسندة فقط.");
    }
    const cleanNote = note?.trim() || "عطل أو حادث";
    if (cleanNote.length > 300) throw new OperationsError("REASON");
    if (trip.breakdownReportedAt) {
      const current = await this.prisma.client.trip.findUniqueOrThrow({ where: { id: tripId }, include: tripInclude });
      return toTripView(current, access);
    }
    const now = new Date();
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const saved = await tx.trip.update({
        where: { id: tripId },
        data: { breakdownReportedAt: now, breakdownNote: cleanNote },
        include: tripInclude,
      });
      await tx.tripEvent.create({
        data: {
          tripId,
          type: "NOTE",
          source: "DRIVER_APP",
          actorId: actor.id,
          occurredAt: now,
          payload: { kind: "BREAKDOWN", note: cleanNote },
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "trip.breakdown_reported",
          entityType: "Trip",
          entityId: tripId,
          reason: cleanNote,
          after: { status: trip.status },
        },
      });
      return saved;
    });
    return toTripView(updated, access);
  }

  async listBreakdowns(actor: PublicUser) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const now = new Date();
    const rows = await this.prisma.client.trip.findMany({
      where: { status: { in: ["ASSIGNED", "DRIVER_ARRIVED", "IN_PROGRESS"] } },
      include: tripInclude,
      orderBy: { arrivesAt: "asc" },
      take: 100,
    });
    const stalled = rows.filter((row) => row.breakdownReportedAt !== null || arrivalState(row, now) === "STALLED");
    return {
      items: stalled.slice(0, 20).map((row) => toTripView(row, { seeAll: true, driverId: null, userId: actor.id })),
    };
  }

  async recordBoarding(
    actor: PublicUser,
    tripId: string,
    passengerId: string,
    input: { status: "BOARDED" | "NO_SHOW" | "CANCELLED"; code?: string; occurredAt?: string },
  ) {
    const access = await this.tripAccess(actor);
    const trip = await this.requireTrip(tripId);
    const owns = linkedToDriver(trip, access.driverId);
    if (!access.seeAll && !owns) throw new OperationsError("NOT_FOUND");
    if (!["ASSIGNED", "DRIVER_ARRIVED", "IN_PROGRESS"].includes(trip.status)) throw new OperationsError("STATE");
    const passenger = await this.prisma.client.tripPassenger.findFirst({ where: { id: passengerId, tripId } });
    if (!passenger) throw new OperationsError("NOT_FOUND");
    let source: "CONTROL" | "DRIVER_APP" | "PASSENGER_CODE" = access.seeAll && !owns ? "CONTROL" : "DRIVER_APP";
    if (input.code) {
      const hashed = hashCode(input.code);
      const left = Buffer.from(hashed);
      const right = Buffer.from(passenger.verificationCodeHash ?? "");
      if (left.length !== right.length || !timingSafeEqual(left, right)) throw new OperationsError("CODE");
      source = "PASSENGER_CODE";
    }
    const when = input.occurredAt ? parseWhen(input.occurredAt) : new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await tx.tripPassenger.update({ where: { id: passenger.id }, data: { boardingStatus: input.status } });
      await tx.boardingEvent.create({
        data: { tripPassengerId: passenger.id, status: input.status, occurredAt: when, source, actorId: actor.id },
      });
      await tx.tripEvent.create({
        data: {
          tripId,
          type: "BOARDING_RECORDED",
          source,
          actorId: actor.id,
          occurredAt: when,
          payload: { passengerId, status: input.status },
        },
      });
    });
    return { updated: true };
  }

  async setCompanyFarePaid(actor: PublicUser, tripId: string, passengerId: string, paid: boolean) {
    await this.assertAny(actor, ["TRIPS_DISPATCH"]);
    const passenger = await this.prisma.client.tripPassenger.findFirst({ where: { id: passengerId, tripId } });
    if (!passenger) throw new OperationsError("NOT_FOUND");
    if (passenger.farePaidToCompany === paid) return { updated: true, farePaidToCompany: paid };
    await this.prisma.client.$transaction(async (tx) => {
      await tx.tripPassenger.update({ where: { id: passenger.id }, data: { farePaidToCompany: paid } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: paid ? "trip_passenger.company_fare_paid" : "trip_passenger.company_fare_unpaid",
          entityType: "TripPassenger",
          entityId: passenger.id,
          before: { tripId, farePaidToCompany: passenger.farePaidToCompany },
          after: { tripId, farePaidToCompany: paid },
        },
      });
    });
    return { updated: true, farePaidToCompany: paid };
  }

  async markFareCollected(actor: PublicUser, tripId: string) {
    const access = await this.tripAccess(actor);
    const trip = await this.requireTrip(tripId);
    const owns = linkedToDriver(trip, access.driverId);
    if (!access.seeAll && !owns) throw new OperationsError("NOT_FOUND");
    if (!["IN_PROGRESS", "COMPLETED"].includes(trip.status)) throw new OperationsError("STATE");
    const now = new Date();
    await this.prisma.client.$transaction(async (tx) => {
      await tx.trip.update({
        where: { id: tripId },
        data: { passengerFareCollectedAt: now, passengerFareCollectedById: actor.id },
      });
      await tx.tripEvent.create({
        data: {
          tripId,
          type: "PASSENGER_FARE_COLLECTED",
          source: owns ? "DRIVER_APP" : "CONTROL",
          actorId: actor.id,
          occurredAt: now,
          payload: { note: "أجرة الراكب النقدية ليست تسديدًا لعمولة الشركة." },
        },
      });
    });
    return { updated: true };
  }

  private assertInsideDestination(
    trip: { destination: { latitude: { toString(): string }; longitude: { toString(): string } } },
    location?: { latitude?: string; longitude?: string },
  ): void {
    const latitude = normalizeCoordinate(location?.latitude ?? "", "lat");
    const longitude = normalizeCoordinate(location?.longitude ?? "", "lng");
    const outside = "إنهاء الرحلة متاح داخل دائرة قطرها 1 كم حول الوجهة.";
    if (!latitude || !longitude) throw new OperationsError("STATE", outside);
    const distance = distanceMeters(
      Number(latitude),
      Number(longitude),
      Number(trip.destination.latitude.toString()),
      Number(trip.destination.longitude.toString()),
    );
    if (!insideDestinationFinishCircle(distance)) throw new OperationsError("STATE", outside);
  }

  private async tripAccess(actor: PublicUser): Promise<{ seeAll: boolean; driverId: string | null; userId: string }> {
    const granted = await this.granted(actor);
    const seeAll = granted.has("TRIPS_VIEW_ALL") || granted.has("TRIPS_DISPATCH") || granted.has("BOOKINGS_MANAGE");
    if (seeAll) return { seeAll: true, driverId: null, userId: actor.id };
    if (!granted.has("TRIPS_OPERATE_OWN")) throw new OperationsError("FORBIDDEN");
    const driver = await this.prisma.client.driverProfile.findUnique({ where: { userId: actor.id } });
    if (!driver) throw new OperationsError("FORBIDDEN");
    return { seeAll: false, driverId: driver.id, userId: actor.id };
  }

  private async requireRunParent(id: string) {
    const trip = await this.prisma.client.trip.findUnique({
      where: { id },
      include: {
        vehicles: {
          where: { disabledAt: null },
          include: {
            vehicle: { select: { id: true, plateNumber: true, capacity: true } },
            driverProfile: { select: { id: true, user: { select: { displayName: true } } } },
          },
        },
        passengers: { include: { passengerContact: { select: { fullName: true, phone: true } }, booking: { select: { status: true } } } },
      },
    });
    if (!trip) throw new OperationsError("NOT_FOUND");
    if (trip.parentTripId) throw new OperationsError("STATE", "لا يمكن إنشاء رحلة فرعية من رحلة فرعية.");
    if (!trip.isDaily) throw new OperationsError("STATE", "الرحلة الفرعية تُنشأ من الرحلة الدائمة فقط.");
    if (trip.status === "CANCELLED") throw new OperationsError("STATE", "لا يمكن تشغيل رحلة ملغاة.");
    return trip;
  }

  private async assignedBookingIds(parentTripId: string, when: Date): Promise<Set<string>> {
    const bounds = utcDayBounds(when);
    const runs = await this.prisma.client.trip.findMany({
      where: {
        parentTripId,
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        scheduledAt: { gte: bounds.start, lt: bounds.end },
      },
      select: { passengers: { where: { boardingStatus: { not: "CANCELLED" } }, select: { bookingId: true } } },
    });
    return new Set(runs.flatMap((run) => run.passengers.map((seat) => seat.bookingId)));
  }

  private async requireTrip(id: string) {
    const trip = await this.prisma.client.trip.findUnique({
      where: { id },
      include: { destination: true, vehicles: { select: { id: true, vehicleId: true, driverProfileId: true, disabledAt: true } } },
    });
    if (!trip) throw new OperationsError("NOT_FOUND");
    return trip;
  }

  private async bookableTrip(id: string, expected: "OUTBOUND" | "RETURN", seatsNeeded = 1) {
    const trip = await this.prisma.client.trip.findUnique({
      where: { id },
      include: {
        destination: true,
        vehicle: true,
        vehicles: { include: { vehicle: { select: { capacity: true } } } },
      },
    });
    if (!trip || trip.direction !== expected || trip.parentTripId) {
      throw new OperationsError("LEG", trip?.parentTripId ? "الحجز يُسجَّل على الرحلة الدائمة، ثم يوزَّع الركاب على رحلة المركبة." : undefined);
    }
    if (!BOOKABLE.has(trip.status)) throw new OperationsError("STATE");
    const activePassengers = await occupiedSeats(this.prisma.client, id);
    const seatCapacity = trip.vehicles.reduce((sum, link) => sum + (link.disabledAt ? 0 : link.vehicle.capacity), 0);
    if (seatCapacity > 0 && activePassengers + seatsNeeded > seatCapacity) throw new OperationsError("CAPACITY");
    return { ...trip, activePassengers, seatCapacity };
  }

  private async refreshPickupTimes(
    tx: Parameters<Parameters<PrismaService["client"]["$transaction"]>[0]>[0],
    tripId: string,
  ): Promise<void> {
    const trip = await tx.trip.findUnique({
      where: { id: tripId },
      include: {
        destination: { select: { latitude: true, longitude: true } },
        passengers: {
          where: { boardingStatus: { not: "CANCELLED" }, booking: { status: "CONFIRMED" } },
          select: { id: true, pickupLatitude: true, pickupLongitude: true },
        },
      },
    });
    if (!trip) return;
    const located = trip.passengers.flatMap((passenger) => {
      if (passenger.pickupLatitude === null || passenger.pickupLongitude === null) return [];
      return [
        {
          id: passenger.id,
          latitude: Number(passenger.pickupLatitude.toString()),
          longitude: Number(passenger.pickupLongitude.toString()),
        },
      ];
    });
    const plan = planPickupTimes({
      departsAt: trip.scheduledAt,
      arrivesAt: trip.arrivesAt,
      destinationLatitude: Number(trip.destination.latitude.toString()),
      destinationLongitude: Number(trip.destination.longitude.toString()),
      passengers: located,
    });
    const pickupById = new Map(plan.map((item) => [item.id, item.pickupAt]));
    for (const passenger of trip.passengers) {
      await tx.tripPassenger.update({
        where: { id: passenger.id },
        data: { pickupAt: pickupById.get(passenger.id) ?? trip.scheduledAt },
      });
    }
  }

  private async readyDriver(id: string): Promise<{ id: string; vehicleId: string; capacity: number }> {
    const driver = await this.prisma.client.driverProfile.findUnique({
      where: { id },
      include: {
        user: true,
        vehicleAssignments: {
          where: { activeTo: null, vehicle: { approvalStatus: "APPROVED", deletedAt: null } },
          include: { vehicle: true },
          orderBy: [{ isPrimary: "desc" }, { activeFrom: "desc" }],
          take: 1,
        },
      },
    });
    const vehicle = driver?.vehicleAssignments[0]?.vehicle;
    if (!driver || driver.deletedAt || driver.approvalStatus !== "APPROVED" || driver.user.status !== "ACTIVE" || driver.assignmentBlocked || !vehicle) {
      throw new OperationsError("ASSIGN");
    }
    return { id: driver.id, vehicleId: vehicle.id, capacity: vehicle.capacity };
  }

  private async areaLink(driverId: string, serviceAreaId: string | null): Promise<AreaLink | null> {
    if (!serviceAreaId) return null;
    const link = await this.prisma.client.driverServiceArea.findFirst({
      where: { driverProfileId: driverId, serviceAreaId, status: { not: "ENDED" } },
      include: { serviceArea: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!link) return null;
    return { status: link.status, preference: link.preference, areaActive: link.serviceArea.isActive };
  }

  private async granted(actor: PublicUser): Promise<Set<string>> {
    const rows = await this.prisma.client.rolePermission.findMany({ where: { role: actor.role } });
    return new Set(rows.map((row) => row.permission));
  }

  private async assertAny(actor: PublicUser, required: string[]): Promise<void> {
    const granted = await this.granted(actor);
    if (!required.every((permission) => granted.has(permission))) throw new OperationsError("FORBIDDEN");
  }

  private async guardCredit(
    tx: Parameters<Parameters<PrismaService["client"]["$transaction"]>[0]>[0],
    driverProfileId: string,
    tripId: string,
  ): Promise<void> {
    try {
      await this.finance.assertAssignmentCredit(tx, { driverProfileId, tripId });
    } catch (error) {
      this.rethrowFinance(error);
    }
  }

  private async guardAccrual(
    tx: Parameters<Parameters<PrismaService["client"]["$transaction"]>[0]>[0],
    tripId: string,
    actorId: string,
  ): Promise<void> {
    try {
      await this.finance.accrueCompletedTrip(tx, tripId, actorId);
    } catch (error) {
      this.rethrowFinance(error);
    }
  }

  private rethrowFinance(error: unknown): never {
    if (error instanceof FinanceError) {
      throw new OperationsError(error.code === "RATE" || error.code === "AMOUNT" ? "FINANCE" : "CREDIT", error.detail);
    }
    throw error;
  }

  private async withReference<T>(
    kind: "FV" | "TR",
    write: (reference: string, tx: Parameters<Parameters<PrismaService["client"]["$transaction"]>[0]>[0]) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.client.$transaction(async (tx) => {
          const now = new Date();
          const day = now.toISOString().slice(0, 10).replaceAll("-", "");
          const prefix = `${kind}-${day}-`;
          const latest =
            kind === "FV"
              ? await tx.booking.findFirst({
                  where: { reference: { startsWith: prefix } },
                  orderBy: { reference: "desc" },
                  select: { reference: true },
                })
              : await tx.trip.findFirst({
                  where: { reference: { startsWith: prefix } },
                  orderBy: { reference: "desc" },
                  select: { reference: true },
                });
          const sequence = latest ? Number(latest.reference.slice(prefix.length)) + 1 : 1;
          const reference = formatDailyReference(kind, day, sequence);
          if (!reference) throw new OperationsError("DUPLICATE");
          return write(reference, tx);
        });
      } catch (error) {
        if (isUniqueConflict(error) && attempt < 4) continue;
        if (isUniqueConflict(error)) throw new OperationsError("DUPLICATE");
        throw error;
      }
    }
    throw new OperationsError("DUPLICATE");
  }
}

const bookingInclude = {
  passengerContact: { select: { id: true, fullName: true, phone: true } },
  passengers: {
    select: {
      fareAmount: true,
      fareCurrency: true,
      pickupNote: true,
      seatCount: true,
      trip: {
        select: {
          id: true,
          reference: true,
          direction: true,
          status: true,
          scheduledAt: true,
          destination: { select: { id: true, name: true, latitude: true, longitude: true } },
        },
      },
    },
  },
} as const;

const tripInclude = {
  destination: { select: { id: true, name: true, latitude: true, longitude: true, addressNote: true, notes: true } },
  parent: { select: { id: true, reference: true } },
  driverProfile: { select: { id: true, userId: true, user: { select: { displayName: true } } } },
  vehicle: { select: { id: true, plateNumber: true, capacity: true } },
  vehicles: {
    select: {
      id: true,
      driverProfileId: true,
      vehicle: { select: { id: true, plateNumber: true, capacity: true } },
      driverProfile: { select: { id: true, userId: true, user: { select: { displayName: true } } } },
      disabledAt: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
  offers: { select: { id: true, driverProfileId: true, status: true, source: true, matchReason: true } },
  passengers: {
    select: {
      id: true,
      boardingStatus: true,
      pickupLatitude: true,
      pickupLongitude: true,
      pickupNote: true,
      pickupAt: true,
      fareAmount: true,
      fareCurrency: true,
      farePaidToCompany: true,
      seatCount: true,
      passengerContact: { select: { fullName: true, phone: true } },
      booking: { select: { id: true, reference: true, status: true } },
    },
  },
} as const;

type TripRow = {
  id: string;
  reference: string;
  parentTripId: string | null;
  parent: { id: string; reference: string } | null;
  direction: string;
  status: string;
  scheduledAt: Date;
  arrivesAt: Date;
  isDaily: boolean;
  originLatitude: { toString(): string } | null;
  originLongitude: { toString(): string } | null;
  notes: string | null;
  assignmentSource: string | null;
  passengerFareCollectedAt: Date | null;
  breakdownReportedAt: Date | null;
  breakdownNote: string | null;
  destination: {
    id: string;
    name: string;
    latitude: { toString(): string };
    longitude: { toString(): string };
    addressNote: string | null;
    notes: string | null;
  };
  driverProfile: { id: string; userId: string; user: { displayName: string } } | null;
  vehicle: { id: string; plateNumber: string; capacity: number } | null;
  vehicles: {
    id: string;
    driverProfileId: string;
    vehicle: { id: string; plateNumber: string; capacity: number };
    driverProfile: { id: string; userId: string; user: { displayName: string } };
    disabledAt: Date | null;
  }[];
  offers: { id: string; driverProfileId: string; status: string; source: string; matchReason: string }[];
  passengers: {
    id: string;
    boardingStatus: string;
    pickupLatitude: { toString(): string } | null;
    pickupLongitude: { toString(): string } | null;
    pickupNote: string | null;
    pickupAt: Date | null;
    fareAmount: { toString(): string } | null;
    fareCurrency: string | null;
      farePaidToCompany: boolean;
      seatCount: number;
      passengerContact: { fullName: string; phone: string };
      booking: { id: string; reference: string; status: string };
  }[];
};

function toBookingView(row: BookingRow) {
  const legs = row.passengers.map((seat) => ({
    tripId: seat.trip.id,
    tripReference: seat.trip.reference,
    direction: seat.trip.direction,
    tripStatus: seat.trip.status,
    scheduledAt: seat.trip.scheduledAt.toISOString(),
    destinationName: seat.trip.destination.name,
    destinationLatitude: seat.trip.destination.latitude.toString(),
    destinationLongitude: seat.trip.destination.longitude.toString(),
    fareAmount: formatStoredFare(seat.fareAmount),
    fareCurrency: seat.fareCurrency,
  }));
  return {
    id: row.id,
    reference: row.reference,
    direction: row.direction,
    status: row.status,
    passengerName: row.passengerContact.fullName,
    passengerPhone: row.passengerContact.phone,
    pickupLatitude: row.pickupLatitude?.toString() ?? null,
    pickupLongitude: row.pickupLongitude?.toString() ?? null,
    pickupNote: row.passengers[0]?.pickupNote ?? null,
    seatCount: row.passengers[0]?.seatCount ?? 1,
    scheduledAt: row.scheduledAt.toISOString(),
    notes: row.notes,
    cancelReason: row.cancelReason,
    legs,
    createdAt: row.createdAt.toISOString(),
  };
}

type DriverMapStop = {
  order: number;
  kind: "driver" | "pickup" | "destination";
  label: string;
  latitude: string;
  longitude: string;
  phone: string | null;
  note: string | null;
  passengerId: string | null;
  fareAmount: string | null;
  fareCurrency: string | null;
  farePaidToCompany: boolean;
};

type DriverMapResult =
  | { phase: "none"; trip: null }
  | {
      phase: "current" | "next";
      trip: {
        id: string;
        reference: string;
        direction: string;
        status: string;
        scheduledAt: string;
        arrivesAt: string;
        plannedDepartureAt: string;
        plannedArrivalAt: string;
        startedAt: string | null;
        arrivalState: "ON_TIME" | "LATE" | "STALLED";
        destinationName: string;
        distanceMeters: number;
        durationSeconds: number;
        provider: string;
        coordinates: { latitude: number; longitude: number }[];
        legs: {
          targetKind: "pickup" | "destination";
          label: string;
          distanceMeters: number;
          durationSeconds: number;
          coordinates: { latitude: number; longitude: number }[];
        }[];
        stops: DriverMapStop[];
        unlocatedPassengers: string[];
        breakdownReportedAt: string | null;
        breakdownNote: string | null;
      };
    };

function coordinateForRoute(value: string, kind: "lat" | "lng"): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "";
  return normalizeCoordinate(parsed.toFixed(6), kind);
}

function driverOperationalTrips(driverId: string) {
  const linked = { vehicles: { some: { driverProfileId: driverId, disabledAt: null } } };
  // A finished run must not hide the daily parent. The parent is the next trip until a live run exists.
  return {
    OR: [
      { AND: [{ OR: [{ parentTripId: { not: null } }, { isDaily: false }] }, linked] },
      {
        AND: [
          { isDaily: true },
          { parentTripId: null },
          linked,
          {
            runs: {
              none: {
                status: { in: ["PENDING_ASSIGNMENT" as const, "OFFERED" as const, "ASSIGNED" as const, "DRIVER_ARRIVED" as const, "IN_PROGRESS" as const] },
                ...linked,
              },
            },
          },
        ],
      },
    ],
  };
}

function linkedToDriver(
  trip: { driverProfileId: string | null; vehicles: { driverProfileId: string; disabledAt?: Date | null }[] },
  driverId: string | null,
): boolean {
  if (!driverId) return false;
  return trip.vehicles.some((link) => link.driverProfileId === driverId && !link.disabledAt);
}

function toTripView(row: TripRow, access: { seeAll: boolean; driverId: string | null; userId: string }) {
  const activeVehicles = row.vehicles.filter((link) => !link.disabledAt);
  const assignedToViewer = activeVehicles.some((link) => link.driverProfile.userId === access.userId);
  const myOffer = row.offers.find((offer) => offer.driverProfileId === access.driverId && offer.status === "PENDING") ?? null;
  const reservedPassengers = row.passengers.filter((passenger) => passenger.boardingStatus !== "CANCELLED");
  const visiblePassengers = reservedPassengers.filter((passenger) => access.seeAll || passenger.booking.status === "CONFIRMED");
  const occupied = reservedPassengers.reduce((sum, passenger) => sum + passenger.seatCount, 0);
  const seatCapacity = activeVehicles.reduce((sum, link) => sum + link.vehicle.capacity, 0);
  const poolTemplate = row.isDaily && !row.parentTripId;
  const hidePoolPassengers = poolTemplate && !["ASSIGNED", "DRIVER_ARRIVED", "IN_PROGRESS"].includes(row.status);
  const need = planVehicleNeed(occupied, activeVehicles.map((link) => link.vehicle.capacity));
  const reveal = revealPassengerDetails({ seeAll: access.seeAll, assignedToViewer: hidePoolPassengers ? false : assignedToViewer });
  return {
    id: row.id,
    reference: row.reference,
    parentTripId: row.parentTripId,
    parentReference: row.parent?.reference ?? null,
    direction: row.direction,
    status: row.status,
    scheduledAt: row.scheduledAt.toISOString(),
    arrivesAt: row.arrivesAt.toISOString(),
    arrivalState: arrivalState(row, new Date()),
    isDaily: row.isDaily,
    originLatitude: row.originLatitude?.toString() ?? null,
    originLongitude: row.originLongitude?.toString() ?? null,
    notes: row.notes,
    destination: {
      id: row.destination.id,
      name: row.destination.name,
      latitude: row.destination.latitude.toString(),
      longitude: row.destination.longitude.toString(),
      addressNote: row.destination.addressNote,
      notes: row.destination.notes,
    },
    passengerCount: occupied,
    vehiclesNeeded: need.needed,
    seatShortfall: need.shortfall,
    driverName: row.driverProfile?.user.displayName ?? null,
    plateNumber: row.vehicle?.plateNumber ?? null,
    capacity: seatCapacity > 0 ? seatCapacity : null,
    vehicles: row.vehicles.map((link) => ({
      id: link.id,
      vehicleId: link.vehicle.id,
      plateNumber: link.vehicle.plateNumber,
      capacity: link.vehicle.capacity,
      driverProfileId: link.driverProfile.id,
      driverName: link.driverProfile.user.displayName,
      disabledAt: link.disabledAt?.toISOString() ?? null,
    })),
    assignmentSource: row.assignmentSource,
    passengerFareCollectedAt: row.passengerFareCollectedAt?.toISOString() ?? null,
    breakdownReportedAt: row.breakdownReportedAt?.toISOString() ?? null,
    breakdownNote: row.breakdownNote,
    myOffer: myOffer ? { id: myOffer.id, source: myOffer.source, matchReason: myOffer.matchReason } : null,
    passengers: reveal
      ? visiblePassengers.map((passenger) => ({
          id: passenger.id,
          bookingId: passenger.booking.id,
          bookingReference: passenger.booking.reference,
          name: passenger.passengerContact.fullName,
          phone: passenger.passengerContact.phone,
          boardingStatus: passenger.boardingStatus,
          pickupLatitude: passenger.pickupLatitude?.toString() ?? null,
          pickupLongitude: passenger.pickupLongitude?.toString() ?? null,
          pickupNote: passenger.pickupNote,
          pickupAt: passenger.pickupAt?.toISOString() ?? null,
          fareAmount: formatStoredFare(passenger.fareAmount),
          fareCurrency: passenger.fareCurrency,
          farePaidToCompany: passenger.farePaidToCompany,
          seatCount: passenger.seatCount,
        }))
      : [],
  };
}

function toDestinationView(row: {
  id: string;
  name: string;
  latitude: { toString(): string };
  longitude: { toString(): string };
  addressNote: string | null;
  notes: string | null;
  isActive: boolean;
}) {
  return {
    id: row.id,
    name: row.name,
    latitude: row.latitude.toString(),
    longitude: row.longitude.toString(),
    addressNote: row.addressNote,
    notes: row.notes,
    isActive: row.isActive,
  };
}

function destinationData(
  input: { name: string; latitude: string; longitude: string; addressNote?: string; notes?: string; isActive?: boolean },
  currentActive = true,
) {
  const name = assertName(input.name);
  const latitude = normalizeCoordinate(input.latitude, "lat");
  const longitude = normalizeCoordinate(input.longitude, "lng");
  if (!latitude || !longitude) throw new OperationsError("COORDINATES");
  return {
    name,
    latitude,
    longitude,
    addressNote: input.addressNote?.trim() || null,
    notes: input.notes?.trim() || null,
    isActive: input.isActive ?? currentActive,
  };
}

function assertSeatCount(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 6) throw new OperationsError("SEATS");
  return value;
}

async function occupiedSeats(
  db: {
    tripPassenger: {
      aggregate: (args: {
        where: { tripId: string; boardingStatus: { not: "CANCELLED" } };
        _sum: { seatCount: true };
      }) => Promise<{ _sum: { seatCount: number | null } }>;
    };
  },
  tripId: string,
): Promise<number> {
  const result = await db.tripPassenger.aggregate({
    where: { tripId, boardingStatus: { not: "CANCELLED" } },
    _sum: { seatCount: true },
  });
  return result._sum.seatCount ?? 0;
}

function assertName(value: string): string {
  const name = value.trim();
  if (name.length < 2 || name.length > 80) throw new OperationsError("NAME");
  return name;
}

function assertReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 300) throw new OperationsError("REASON");
  return reason;
}

function parseWhen(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new OperationsError("DATE");
  return date;
}

function utcDayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function assertRunDay(scheduledAt: Date): void {
  const today = utcDayBounds(new Date()).start;
  if (scheduledAt.getTime() < today.getTime()) {
    throw new OperationsError("DATE", "تاريخ الرحلة الفرعية يجب أن يكون اليوم أو بعده.");
  }
}

function parseOrigin(latitudeRaw: string, longitudeRaw: string): { latitude: number; longitude: number; latitudeText: string; longitudeText: string } {
  const latitudeText = normalizeCoordinate(latitudeRaw, "lat");
  const longitudeText = normalizeCoordinate(longitudeRaw, "lng");
  if (!latitudeText || !longitudeText) throw new OperationsError("COORDINATES", "حدد موقع انطلاق السائق قبل توزيع الركاب.");
  return { latitude: Number(latitudeText), longitude: Number(longitudeText), latitudeText, longitudeText };
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
