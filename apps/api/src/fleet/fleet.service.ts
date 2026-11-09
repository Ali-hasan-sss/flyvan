import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { decideOffer, type AreaLink, type OfferDecision } from "@flyvan/types";
import { Argon2PasswordHasher } from "../auth/argon2-password-hasher";
import { normalizeEmail, normalizePhone } from "../auth/identity";
import { removeStoredFile, storeUpload, type StoredUpload } from "../files/stored-files";
import { PrismaService } from "../prisma/prisma.service";
import { hasValidApprovalDocument } from "./approval-policy";
import { FleetError } from "./fleet.errors";

type ApprovalStatus = "PENDING" | "APPROVED" | "SUSPENDED" | "REJECTED";
type ReviewStatus = "APPROVED" | "REJECTED";
type AreaKind = "CITY" | "DISTRICT" | "GEOFENCE";
type AreaPreference = "TARGET" | "EXCLUDED";

export type VehicleSummary = {
  id: string;
  plateNumber: string;
  capacity: number;
  vehicleType: string;
  approvalStatus: string;
  isPrimary: boolean;
  imageUrl: string | null;
  documentUrl: string | null;
  assignedDriver: { id: string; displayName: string } | null;
};

export type VehicleDetail = VehicleSummary & {
  createdAt: string;
  deletedAt: string | null;
  documents: DocumentView[];
  stats: DriverStats;
};

export type DriverView = {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  userStatus: string;
  approvalStatus: string;
  nearbyRadiusMeters: number;
  acceptsNearbyRequests: boolean;
  assignmentBlocked: boolean;
  createdAt: string;
  deletedAt: string | null;
  tripCount: number;
  imageUrl: string | null;
  primaryVehicle: VehicleSummary | null;
};

export type MoneyTotal = { currency: string; amount: string };

export type DriverStats = {
  tripCount: number;
  commissionTotals: MoneyTotal[];
  outstandingTotals: MoneyTotal[];
};

export type DocumentView = {
  id: string;
  kind: string;
  status: string;
  expiresOn: string | null;
};

export type AreaLinkView = {
  id: string;
  serviceAreaId: string;
  name: string;
  kind: string;
  preference: string;
  status: string;
  areaActive: boolean;
};

const vehicleDetailInclude = {
  documents: { where: { ownerType: "VEHICLE" as const }, orderBy: { createdAt: "desc" as const } },
  assignments: {
    where: { activeTo: null },
    orderBy: { activeFrom: "desc" as const },
    take: 1,
    include: { driverProfile: { select: { id: true, user: { select: { displayName: true } } } } },
  },
  _count: { select: { trips: true } },
};

const driverInclude = {
  user: { select: { displayName: true, phone: true, email: true, status: true } },
  vehicleAssignments: {
    where: { activeTo: null },
    include: { vehicle: true },
    orderBy: [{ isPrimary: "desc" as const }, { activeFrom: "desc" as const }],
    take: 1,
  },
  _count: { select: { trips: true } },
};

@Injectable()
export class FleetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: Argon2PasswordHasher,
  ) {}

  async listDrivers(query: {
    page: number;
    pageSize: number;
    sort: "name" | "createdAt" | "activity";
    direction: "asc" | "desc";
    deleted: boolean;
    search?: string;
  }): Promise<{ items: DriverView[]; page: number; pageSize: number; total: number }> {
    const term = query.search?.trim();
    const where = {
      deletedAt: query.deleted ? { not: null } : null,
      ...(term
        ? {
            OR: [
              { user: { displayName: { contains: term, mode: "insensitive" as const } } },
              { user: { phone: { contains: term, mode: "insensitive" as const } } },
              { user: { email: { contains: term, mode: "insensitive" as const } } },
              {
                vehicleAssignments: {
                  some: {
                    activeTo: null,
                    vehicle: { plateNumber: { contains: term, mode: "insensitive" as const } },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const orderBy =
      query.sort === "name"
        ? { user: { displayName: query.direction } }
        : query.sort === "activity"
          ? { trips: { _count: query.direction } }
          : { createdAt: query.direction };
    const [total, rows] = await Promise.all([
      this.prisma.client.driverProfile.count({ where }),
      this.prisma.client.driverProfile.findMany({
        where,
        include: driverInclude,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map((row) => toDriverView(row)), page: query.page, pageSize: query.pageSize, total };
  }

  async archiveDriver(actorId: string, id: string): Promise<DriverView> {
    const existing = await this.requireDriver(id);
    if (existing.deletedAt) {
      throw new FleetError("ALREADY_ARCHIVED");
    }
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.driverProfile.update({
        where: { id },
        data: { deletedAt: new Date() },
        include: driverInclude,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "driver.archived",
          entityType: "DriverProfile",
          entityId: id,
          after: { deletedAt: row.deletedAt?.toISOString() ?? null },
        },
      });
      return row;
    });
    return toDriverView(updated);
  }

  async getDriver(id: string): Promise<DriverView & { documents: DocumentView[]; serviceAreas: AreaLinkView[]; stats: DriverStats }> {
    const row = await this.prisma.client.driverProfile.findUnique({
      where: { id },
      include: {
        ...driverInclude,
        documents: { where: { ownerType: "DRIVER" }, orderBy: { createdAt: "desc" } },
        serviceAreas: { include: { serviceArea: true }, orderBy: { updatedAt: "desc" } },
      },
    });
    if (!row) {
      throw new FleetError("NOT_FOUND");
    }
    return {
      ...toDriverView(row),
      documents: row.documents.map(toDocumentView),
      serviceAreas: row.serviceAreas.map(toAreaLinkView),
      stats: await this.driverStats(id, row._count.trips),
    };
  }

  async updateDriver(
    actorId: string,
    id: string,
    input: { displayName?: string; phone?: string; email?: string | null; clearPhoto?: boolean; photo?: StoredUpload },
  ): Promise<DriverView> {
    const existing = await this.prisma.client.driverProfile.findUnique({
      where: { id },
      include: driverInclude,
    });
    if (!existing) {
      throw new FleetError("NOT_FOUND");
    }
    const displayName = input.displayName === undefined ? undefined : assertName(input.displayName);
    const phone = input.phone === undefined ? undefined : normalizePhone(input.phone);
    if (input.phone !== undefined && !phone) {
      throw new FleetError("PHONE");
    }
    const email = input.email === undefined ? undefined : input.email === null ? null : normalizeEmail(input.email);
    if (typeof input.email === "string" && !email) {
      throw new FleetError("EMAIL");
    }
    let storedUrl: string | null = null;
    try {
      if (input.photo) {
        storedUrl = await storeUpload(input.photo, "image");
      }
      const imageUrl = storedUrl ?? (input.clearPhoto ? null : existing.imageUrl);
      const unchanged =
        displayName === undefined &&
        phone === undefined &&
        email === undefined &&
        imageUrl === existing.imageUrl;
      if (unchanged) {
        return toDriverView(existing);
      }
      const updated = await this.prisma.client.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: existing.userId },
          data: {
            ...(displayName === undefined ? {} : { displayName }),
            ...(phone === undefined ? {} : { phone }),
            ...(email === undefined ? {} : { email }),
          },
        });
        const row = await tx.driverProfile.update({
          where: { id },
          data: { imageUrl },
          include: driverInclude,
        });
        await tx.auditLog.create({
          data: {
            actorId,
            action: "driver.updated",
            entityType: "DriverProfile",
            entityId: id,
            before: {
              displayName: existing.user.displayName,
              phone: existing.user.phone,
              email: existing.user.email,
              imageUrl: existing.imageUrl,
            },
            after: { displayName: row.user.displayName, phone: row.user.phone, email: row.user.email, imageUrl: row.imageUrl },
          },
        });
        return row;
      });
      if (imageUrl !== existing.imageUrl) {
        await removeStoredFile(existing.imageUrl);
      }
      return toDriverView(updated);
    } catch (error) {
      await removeStoredFile(storedUrl);
      if (isUniqueConflict(error)) {
        throw new FleetError("DUPLICATE");
      }
      throw error;
    }
  }

  async changeDriverPassword(actorId: string, id: string, password: string): Promise<{ updated: true }> {
    if (password.length < 8 || password.length > 200) {
      throw new FleetError("PASSWORD");
    }
    const existing = await this.requireDriver(id);
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.update({ where: { id: existing.userId }, data: { passwordHash } });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "driver.password_changed",
          entityType: "User",
          entityId: existing.userId,
          after: { passwordChanged: true },
        },
      });
    });
    return { updated: true };
  }

  private async driverStats(id: string, tripCount: number): Promise<DriverStats> {
    return this.collectStats({ driverProfileId: id }, tripCount);
  }

  private async collectStats(
    where: { driverProfileId: string } | { trip: { vehicleId: string } },
    tripCount: number,
  ): Promise<DriverStats> {
    const commissions = await this.prisma.client.tripCommission.findMany({
      where: { ...where, status: { in: ["DUE", "PARTIALLY_PAID", "PAID", "DISPUTED"] } },
      select: {
        commissionAmount: true,
        currency: true,
        status: true,
        allocations: { select: { amount: true, currency: true, settlement: { select: { status: true } } } },
      },
    });
    const earned = new Map<string, bigint>();
    const outstanding = new Map<string, bigint>();
    for (const commission of commissions) {
      const amount = toCents(commission.commissionAmount.toString());
      earned.set(commission.currency, (earned.get(commission.currency) ?? 0n) + amount);
      if (commission.status === "PAID") continue;
      const paid = commission.allocations.reduce((sum, allocation) => {
        if (allocation.settlement.status !== "APPROVED" || allocation.currency !== commission.currency) return sum;
        return sum + toCents(allocation.amount.toString());
      }, 0n);
      const remaining = amount > paid ? amount - paid : 0n;
      outstanding.set(commission.currency, (outstanding.get(commission.currency) ?? 0n) + remaining);
    }
    return {
      tripCount,
      commissionTotals: moneyTotals(earned),
      outstandingTotals: moneyTotals(outstanding),
    };
  }

  async createDriver(
    actorId: string,
    input: {
      displayName: string;
      phone: string;
      password: string;
      email?: string;
      vehicle?: { plateNumber: string; capacity: number; vehicleType: string };
      image?: StoredUpload;
      document?: StoredUpload;
    },
  ): Promise<DriverView> {
    const displayName = assertName(input.displayName);
    const phone = normalizePhone(input.phone);
    if (!phone) {
      throw new FleetError("PHONE");
    }
    if (input.password.length < 8 || input.password.length > 200) {
      throw new FleetError("PASSWORD");
    }
    const email = input.email === undefined ? null : normalizeEmail(input.email);
    if (input.email !== undefined && !email) {
      throw new FleetError("EMAIL");
    }
    const vehicle = input.vehicle ? prepareVehicle(input.vehicle) : null;
    if (vehicle && !input.image) {
      throw new FleetError("IMAGE_REQUIRED");
    }
    if (!vehicle && (input.image || input.document)) {
      throw new FleetError("PLATE");
    }
    const passwordHash = await this.passwords.hash(input.password);
    const userId = randomUUID();
    let imageUrl: string | null = null;
    let documentUrl: string | null = null;
    try {
      imageUrl = input.image ? await storeUpload(input.image, "image") : null;
      documentUrl = input.document ? await storeUpload(input.document, "document") : null;
      const profile = await this.prisma.client.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id: userId,
            email,
            phone,
            passwordHash,
            displayName,
            role: "DRIVER",
            status: "ACTIVE",
          },
        });
        const created = await tx.driverProfile.create({ data: { userId } });
        let vehicleId: string | null = null;
        if (vehicle) {
          const createdVehicle = await tx.vehicle.create({
            data: {
              plateNumber: vehicle.plateNumber,
              capacity: vehicle.capacity,
              vehicleType: vehicle.vehicleType,
              approvalStatus: "PENDING",
              imageUrl,
              documentUrl,
            },
          });
          vehicleId = createdVehicle.id;
          const assignment = await tx.driverVehicleAssignment.create({
            data: { driverProfileId: created.id, vehicleId, isPrimary: true },
          });
          await tx.auditLog.create({
            data: {
              actorId,
              action: "vehicle.created",
              entityType: "Vehicle",
              entityId: vehicleId,
              after: vehicle,
            },
          });
          await tx.auditLog.create({
            data: {
              actorId,
              action: "vehicle.assigned",
              entityType: "DriverVehicleAssignment",
              entityId: assignment.id,
              after: { driverProfileId: created.id, vehicleId, isPrimary: true },
            },
          });
        }
        await tx.auditLog.create({
          data: {
            actorId,
            action: "driver.created",
            entityType: "DriverProfile",
            entityId: created.id,
            after: {
              displayName,
              phone,
              email,
              approvalStatus: created.approvalStatus,
              vehicleId,
            },
          },
        });
        const full = await tx.driverProfile.findUnique({ where: { id: created.id }, include: driverInclude });
        if (!full) {
          throw new FleetError("NOT_FOUND");
        }
        return full;
      });
      return toDriverView(profile);
    } catch (error) {
      await removeStoredFile(imageUrl);
      await removeStoredFile(documentUrl);
      if (error instanceof FleetError) {
        throw error;
      }
      if (isUniqueConflict(error)) {
        throw new FleetError("DUPLICATE");
      }
      throw error;
    }
  }

  async setDriverApproval(actorId: string, id: string, status: ApprovalStatus, reason?: string): Promise<DriverView> {
    const cleanReason = approvalReason(status, reason);
    const existing = await this.requireDriver(id);
    if (existing.deletedAt) {
      throw new FleetError("ARCHIVED");
    }
    if (status === "APPROVED") {
      await this.assertDriverDocuments(id);
    }
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.driverProfile.update({
        where: { id },
        data: { approvalStatus: status },
        include: driverInclude,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "driver.approval_changed",
          entityType: "DriverProfile",
          entityId: id,
          reason: cleanReason,
          before: { approvalStatus: existing.approvalStatus },
          after: { approvalStatus: status },
        },
      });
      return row;
    });
    return toDriverView(updated);
  }

  async setAssignmentHold(actorId: string, id: string, blocked: boolean, reason: string): Promise<DriverView> {
    const cleanReason = assertReason(reason);
    const existing = await this.requireDriver(id);
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.driverProfile.update({
        where: { id },
        data: {
          assignmentBlocked: blocked,
          assignmentBlockReason: blocked ? cleanReason : null,
        },
        include: driverInclude,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "driver.assignment_hold_changed",
          entityType: "DriverProfile",
          entityId: id,
          reason: cleanReason,
          before: { assignmentBlocked: existing.assignmentBlocked },
          after: { assignmentBlocked: blocked },
        },
      });
      return row;
    });
    return toDriverView(updated);
  }

  async ownProfile(userId: string): Promise<
    DriverView & {
      documents: DocumentView[];
      serviceAreas: AreaLinkView[];
      availableAreas: { id: string; name: string; kind: string }[];
    }
  > {
    const row = await this.prisma.client.driverProfile.findUnique({
      where: { userId },
      include: {
        ...driverInclude,
        documents: { where: { ownerType: "DRIVER" }, orderBy: { createdAt: "desc" } },
        serviceAreas: { include: { serviceArea: true }, orderBy: { updatedAt: "desc" } },
      },
    });
    if (!row) {
      throw new FleetError("NOT_FOUND");
    }
    const availableAreas = await this.prisma.client.serviceArea.findMany({
      where: { isActive: true },
      select: { id: true, name: true, kind: true },
      orderBy: { name: "asc" },
      take: 200,
    });
    return {
      ...toDriverView(row),
      documents: row.documents.map(toDocumentView),
      serviceAreas: row.serviceAreas.map(toAreaLinkView),
      availableAreas,
    };
  }

  async updateOwnPreferences(
    userId: string,
    input: { nearbyRadiusMeters?: number; acceptsNearbyRequests?: boolean },
  ): Promise<DriverView> {
    if (input.nearbyRadiusMeters === undefined && input.acceptsNearbyRequests === undefined) {
      throw new FleetError("EMPTY");
    }
    if (
      input.nearbyRadiusMeters !== undefined &&
      (input.nearbyRadiusMeters < 500 || input.nearbyRadiusMeters > 50_000)
    ) {
      throw new FleetError("RADIUS");
    }
    const existing = await this.prisma.client.driverProfile.findUnique({ where: { userId } });
    if (!existing) {
      throw new FleetError("NOT_FOUND");
    }
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.driverProfile.update({
        where: { id: existing.id },
        data: {
          ...(input.nearbyRadiusMeters === undefined ? {} : { nearbyRadiusMeters: input.nearbyRadiusMeters }),
          ...(input.acceptsNearbyRequests === undefined
            ? {}
            : { acceptsNearbyRequests: input.acceptsNearbyRequests }),
        },
        include: driverInclude,
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "driver.preferences_updated",
          entityType: "DriverProfile",
          entityId: existing.id,
          before: {
            nearbyRadiusMeters: existing.nearbyRadiusMeters,
            acceptsNearbyRequests: existing.acceptsNearbyRequests,
          },
          after: {
            nearbyRadiusMeters: row.nearbyRadiusMeters,
            acceptsNearbyRequests: row.acceptsNearbyRequests,
          },
        },
      });
      return row;
    });
    return toDriverView(updated);
  }

  async requestOwnArea(userId: string, serviceAreaId: string, preference: AreaPreference): Promise<AreaLinkView> {
    if (preference !== "TARGET" && preference !== "EXCLUDED") {
      throw new FleetError("PREFERENCE");
    }
    const profile = await this.prisma.client.driverProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw new FleetError("NOT_FOUND");
    }
    const area = await this.prisma.client.serviceArea.findUnique({ where: { id: serviceAreaId } });
    if (!area?.isActive) {
      throw new FleetError("NOT_FOUND");
    }
    const link = await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.driverServiceArea.findFirst({
        where: { driverProfileId: profile.id, serviceAreaId, status: { not: "ENDED" } },
      });
      const saved = existing
        ? await tx.driverServiceArea.update({
            where: { id: existing.id },
            data: { preference, status: "PENDING" },
            include: { serviceArea: true },
          })
        : await tx.driverServiceArea.create({
            data: { driverProfileId: profile.id, serviceAreaId, preference, status: "PENDING" },
            include: { serviceArea: true },
          });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "driver_service_area.requested",
          entityType: "DriverServiceArea",
          entityId: saved.id,
          after: { serviceAreaId, preference, status: "PENDING" },
        },
      });
      return saved;
    });
    return toAreaLinkView(link);
  }

  async addDriverDocument(actorId: string, driverId: string, kind: string, expiresOn?: string): Promise<DocumentView> {
    await this.requireDriver(driverId);
    return this.addDocument(actorId, "DRIVER", driverId, kind, expiresOn);
  }

  async reviewDriverDocument(actorId: string, documentId: string, status: ReviewStatus): Promise<DocumentView> {
    return this.reviewDocument(actorId, documentId, "DRIVER", status);
  }

  async listVehicles(query: {
    page: number;
    pageSize: number;
    sort: "plate" | "createdAt" | "activity";
    direction: "asc" | "desc";
    deleted: boolean;
    search?: string;
  }): Promise<{ items: VehicleSummary[]; page: number; pageSize: number; total: number }> {
    const term = query.search?.trim();
    const where = {
      deletedAt: query.deleted ? { not: null } : null,
      ...(term
        ? {
            OR: [
              { plateNumber: { contains: term, mode: "insensitive" as const } },
              { vehicleType: { contains: term, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const orderBy =
      query.sort === "plate"
        ? { plateNumber: query.direction }
        : query.sort === "activity"
          ? { trips: { _count: query.direction } }
          : { createdAt: query.direction };
    const [total, rows] = await Promise.all([
      this.prisma.client.vehicle.count({ where }),
      this.prisma.client.vehicle.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          assignments: {
            where: { activeTo: null },
            orderBy: { activeFrom: "desc" as const },
            take: 1,
            include: {
              driverProfile: { select: { id: true, user: { select: { displayName: true } } } },
            },
          },
        },
      }),
    ]);
    return {
      items: rows.map((row) => {
        const assignment = row.assignments[0];
        return toVehicleSummary(
          row,
          assignment?.isPrimary ?? false,
          assignment
            ? { id: assignment.driverProfile.id, displayName: assignment.driverProfile.user.displayName }
            : null,
        );
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async createVehicle(
    actorId: string,
    input: { plateNumber: string; capacity: number; vehicleType: string; image: StoredUpload; document?: StoredUpload },
  ): Promise<VehicleSummary> {
    const vehicle = prepareVehicle(input);
    let imageUrl: string | null = null;
    let documentUrl: string | null = null;
    try {
      imageUrl = await storeUpload(input.image, "image");
      documentUrl = input.document ? await storeUpload(input.document, "document") : null;
      const created = await this.prisma.client.$transaction(async (tx) => {
        const createdVehicle = await tx.vehicle.create({
          data: { ...vehicle, approvalStatus: "PENDING", imageUrl, documentUrl },
        });
        await tx.auditLog.create({
          data: {
            actorId,
            action: "vehicle.created",
            entityType: "Vehicle",
            entityId: createdVehicle.id,
            after: vehicle,
          },
        });
        return createdVehicle;
      });
      return toVehicleSummary(created, false);
    } catch (error) {
      await removeStoredFile(imageUrl);
      await removeStoredFile(documentUrl);
      if (isUniqueConflict(error)) {
        throw new FleetError("DUPLICATE");
      }
      throw error;
    }
  }

  async getVehicle(id: string): Promise<VehicleDetail> {
    const row = await this.vehicleRecord(id);
    return this.toVehicleDetail(row);
  }

  async updateVehicle(
    actorId: string,
    id: string,
    input: {
      plateNumber?: string;
      capacity?: number;
      vehicleType?: string;
      clearDocument?: boolean;
      image?: StoredUpload;
      document?: StoredUpload;
    },
  ): Promise<VehicleSummary> {
    const existing = await this.prisma.client.vehicle.findUnique({ where: { id } });
    if (!existing) {
      throw new FleetError("NOT_FOUND");
    }
    const plateNumber = input.plateNumber === undefined ? existing.plateNumber : normalizePlate(input.plateNumber);
    const vehicleType = input.vehicleType === undefined ? existing.vehicleType : input.vehicleType.trim();
    if (vehicleType.length < 2 || vehicleType.length > 40) {
      throw new FleetError("TYPE");
    }
    const capacity = input.capacity === undefined ? existing.capacity : input.capacity;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20) {
      throw new FleetError("CAPACITY");
    }
    let storedImage: string | null = null;
    let storedDocument: string | null = null;
    try {
      if (input.image) storedImage = await storeUpload(input.image, "image");
      if (input.document) storedDocument = await storeUpload(input.document, "document");
      const imageUrl = storedImage ?? existing.imageUrl;
      if (!imageUrl) {
        throw new FleetError("IMAGE_REQUIRED");
      }
      const documentUrl = storedDocument ?? (input.clearDocument ? null : existing.documentUrl);
      const unchanged =
        plateNumber === existing.plateNumber &&
        vehicleType === existing.vehicleType &&
        capacity === existing.capacity &&
        imageUrl === existing.imageUrl &&
        documentUrl === existing.documentUrl;
      if (unchanged) {
        const current = await this.vehicleRecord(id);
        return this.toVehicleDetail(current);
      }
      const updated = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.vehicle.update({
          where: { id },
          data: { plateNumber, vehicleType, capacity, imageUrl, documentUrl },
          include: vehicleDetailInclude,
        });
        await tx.auditLog.create({
          data: {
            actorId,
            action: "vehicle.updated",
            entityType: "Vehicle",
            entityId: id,
            before: {
              plateNumber: existing.plateNumber,
              vehicleType: existing.vehicleType,
              capacity: existing.capacity,
              imageUrl: existing.imageUrl,
              documentUrl: existing.documentUrl,
            },
            after: { plateNumber, vehicleType, capacity, imageUrl, documentUrl },
          },
        });
        return row;
      });
      if (imageUrl !== existing.imageUrl) await removeStoredFile(existing.imageUrl);
      if (documentUrl !== existing.documentUrl) await removeStoredFile(existing.documentUrl);
      return this.toVehicleDetail(updated);
    } catch (error) {
      await removeStoredFile(storedImage);
      await removeStoredFile(storedDocument);
      if (isUniqueConflict(error)) {
        throw new FleetError("DUPLICATE");
      }
      throw error;
    }
  }

  async archiveVehicle(actorId: string, id: string): Promise<VehicleSummary> {
    const existing = await this.prisma.client.vehicle.findUnique({ where: { id } });
    if (!existing) {
      throw new FleetError("NOT_FOUND");
    }
    if (existing.deletedAt) {
      throw new FleetError("VEHICLE_ALREADY_ARCHIVED");
    }
    const now = new Date();
    const updated = await this.prisma.client.$transaction(async (tx) => {
      await tx.driverVehicleAssignment.updateMany({
        where: { vehicleId: id, activeTo: null },
        data: { activeTo: now },
      });
      const row = await tx.vehicle.update({
        where: { id },
        data: { deletedAt: now },
        include: vehicleDetailInclude,
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "vehicle.archived",
          entityType: "Vehicle",
          entityId: id,
          after: { deletedAt: row.deletedAt?.toISOString() ?? null },
        },
      });
      return row;
    });
    return this.toVehicleDetail(updated);
  }

  async setVehicleApproval(actorId: string, id: string, status: ApprovalStatus, reason?: string): Promise<VehicleSummary> {
    const cleanReason = approvalReason(status, reason);
    const existing = await this.prisma.client.vehicle.findUnique({ where: { id } });
    if (!existing) {
      throw new FleetError("NOT_FOUND");
    }
    if (existing.deletedAt) {
      throw new FleetError("VEHICLE_ARCHIVED");
    }
    if (status === "APPROVED" && !existing.imageUrl) {
      throw new FleetError("IMAGE_REQUIRED");
    }
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.update({
        where: { id },
        data: { approvalStatus: status },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "vehicle.approval_changed",
          entityType: "Vehicle",
          entityId: id,
          reason: cleanReason,
          before: { approvalStatus: existing.approvalStatus },
          after: { approvalStatus: status },
        },
      });
      return vehicle;
    });
    return toVehicleSummary(updated, false);
  }

  async assignVehicle(
    actorId: string,
    vehicleId: string,
    driverProfileId: string,
    isPrimary = true,
  ): Promise<{ id: string; vehicleId: string; driverProfileId: string; isPrimary: boolean }> {
    const driver = await this.requireDriver(driverProfileId);
    if (driver.deletedAt) {
      throw new FleetError("ARCHIVED");
    }
    const vehicle = await this.prisma.client.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) {
      throw new FleetError("NOT_FOUND");
    }
    if (vehicle.deletedAt) {
      throw new FleetError("VEHICLE_ARCHIVED");
    }
    const now = new Date();
    const assignment = await this.prisma.client.$transaction(async (tx) => {
      await tx.driverVehicleAssignment.updateMany({
        where: { vehicleId, activeTo: null },
        data: { activeTo: now },
      });
      if (isPrimary) {
        await tx.driverVehicleAssignment.updateMany({
          where: { driverProfileId, isPrimary: true, activeTo: null },
          data: { activeTo: now },
        });
      }
      const created = await tx.driverVehicleAssignment.create({
        data: { driverProfileId, vehicleId, isPrimary, activeFrom: now },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "vehicle.assigned",
          entityType: "DriverVehicleAssignment",
          entityId: created.id,
          after: { driverProfileId, vehicleId, isPrimary },
        },
      });
      return created;
    });
    return {
      id: assignment.id,
      vehicleId: assignment.vehicleId,
      driverProfileId: assignment.driverProfileId,
      isPrimary: assignment.isPrimary,
    };
  }

  async addVehicleDocument(actorId: string, vehicleId: string, kind: string, expiresOn?: string): Promise<DocumentView> {
    const vehicle = await this.prisma.client.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) {
      throw new FleetError("NOT_FOUND");
    }
    return this.addDocument(actorId, "VEHICLE", vehicleId, kind, expiresOn);
  }

  async reviewVehicleDocument(actorId: string, documentId: string, status: ReviewStatus): Promise<DocumentView> {
    return this.reviewDocument(actorId, documentId, "VEHICLE", status);
  }

  async listAreas(): Promise<{
    items: {
      id: string;
      name: string;
      kind: string;
      isActive: boolean;
      parentId: string | null;
      centerLatitude: string | null;
      centerLongitude: string | null;
      approvedDriverCount: number;
    }[];
    links: {
      id: string;
      driverProfileId: string;
      driverName: string;
      serviceAreaId: string;
      areaName: string;
      preference: string;
      status: string;
    }[];
  }> {
    const [areas, links] = await Promise.all([
      this.prisma.client.serviceArea.findMany({
        orderBy: { name: "asc" },
        take: 200,
        include: { _count: { select: { driverLinks: { where: { status: "APPROVED", preference: "TARGET" } } } } },
      }),
      this.prisma.client.driverServiceArea.findMany({
        where: { status: "PENDING" },
        include: { serviceArea: true, driverProfile: { include: { user: true } } },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
    ]);
    return {
      items: areas.map((area) => ({
        id: area.id,
        name: area.name,
        kind: area.kind,
        isActive: area.isActive,
        parentId: area.parentId,
        centerLatitude: area.centerLatitude?.toString() ?? null,
        centerLongitude: area.centerLongitude?.toString() ?? null,
        approvedDriverCount: area._count.driverLinks,
      })),
      links: links.map((link) => ({
        id: link.id,
        driverProfileId: link.driverProfileId,
        driverName: link.driverProfile.user.displayName,
        serviceAreaId: link.serviceAreaId,
        areaName: link.serviceArea.name,
        preference: link.preference,
        status: link.status,
      })),
    };
  }

  async createArea(
    actorId: string,
    input: {
      name: string;
      kind: AreaKind;
      parentId?: string;
      centerLatitude?: number;
      centerLongitude?: number;
    },
  ): Promise<{ id: string; name: string; kind: AreaKind; isActive: boolean }> {
    const name = assertName(input.name);
    if (input.kind !== "CITY" && input.kind !== "DISTRICT" && input.kind !== "GEOFENCE") {
      throw new FleetError("KIND");
    }
    const hasLatitude = input.centerLatitude !== undefined;
    const hasLongitude = input.centerLongitude !== undefined;
    if (hasLatitude !== hasLongitude) {
      throw new FleetError("COORDINATES");
    }
    if (input.parentId) {
      const parent = await this.prisma.client.serviceArea.findUnique({ where: { id: input.parentId } });
      if (!parent) {
        throw new FleetError("NOT_FOUND");
      }
    }
    const created = await this.prisma.client.$transaction(async (tx) => {
      const area = await tx.serviceArea.create({
        data: {
          name,
          kind: input.kind,
          parentId: input.parentId ?? null,
          centerLatitude: input.centerLatitude ?? null,
          centerLongitude: input.centerLongitude ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "service_area.created",
          entityType: "ServiceArea",
          entityId: area.id,
          after: { name, kind: input.kind, parentId: input.parentId ?? null },
        },
      });
      return area;
    });
    return {
      id: created.id,
      name: created.name,
      kind: created.kind as AreaKind,
      isActive: created.isActive,
    };
  }

  async setAreaActive(
    actorId: string,
    id: string,
    isActive: boolean,
  ): Promise<{ id: string; name: string; kind: AreaKind; isActive: boolean }> {
    const existing = await this.prisma.client.serviceArea.findUnique({ where: { id } });
    if (!existing) {
      throw new FleetError("NOT_FOUND");
    }
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const area = await tx.serviceArea.update({ where: { id }, data: { isActive } });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "service_area.updated",
          entityType: "ServiceArea",
          entityId: id,
          before: { isActive: existing.isActive },
          after: { isActive },
        },
      });
      return area;
    });
    return { id: updated.id, name: updated.name, kind: updated.kind as AreaKind, isActive: updated.isActive };
  }

  async reviewAreaLink(actorId: string, id: string, status: ReviewStatus): Promise<AreaLinkView> {
    if (status !== "APPROVED" && status !== "REJECTED") {
      throw new FleetError("STATUS");
    }
    const existing = await this.prisma.client.driverServiceArea.findUnique({
      where: { id },
      include: { serviceArea: true },
    });
    if (!existing) {
      throw new FleetError("NOT_FOUND");
    }
    if (existing.status !== "PENDING") {
      throw new FleetError("REVIEW_STATE");
    }
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const link = await tx.driverServiceArea.update({
        where: { id },
        data: { status },
        include: { serviceArea: true },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "driver_service_area.reviewed",
          entityType: "DriverServiceArea",
          entityId: id,
          before: { status: existing.status },
          after: { status },
        },
      });
      return link;
    });
    return toAreaLinkView(updated);
  }

  async previewOffer(input: {
    driverProfileId: string;
    straightLineMeters?: number;
    serviceAreaId?: string;
  }): Promise<OfferDecision> {
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
    if (!driver) {
      throw new FleetError("NOT_FOUND");
    }
    let area: AreaLink | null = null;
    if (input.serviceAreaId) {
      const link = await this.prisma.client.driverServiceArea.findFirst({
        where: { driverProfileId: driver.id, serviceAreaId: input.serviceAreaId, status: { not: "ENDED" } },
        include: { serviceArea: true },
        orderBy: { updatedAt: "desc" },
      });
      if (link) {
        area = {
          status: link.status,
          preference: link.preference,
          areaActive: link.serviceArea.isActive,
        };
      }
    }
    const vehicle = driver.vehicleAssignments[0]?.vehicle;
    return decideOffer({
      driverApproved:
        driver.deletedAt === null && driver.approvalStatus === "APPROVED" && driver.user.status === "ACTIVE",
      vehicleApproved: Boolean(vehicle && vehicle.deletedAt === null && vehicle.approvalStatus === "APPROVED"),
      assignmentBlocked: driver.assignmentBlocked,
      acceptsNearby: driver.acceptsNearbyRequests,
      nearbyRadiusMeters: driver.nearbyRadiusMeters,
      straightLineMeters: input.straightLineMeters ?? null,
      area,
    });
  }

  private async vehicleRecord(id: string) {
    const row = await this.prisma.client.vehicle.findUnique({ where: { id }, include: vehicleDetailInclude });
    if (!row) {
      throw new FleetError("NOT_FOUND");
    }
    return row;
  }

  private async toVehicleDetail(row: Awaited<ReturnType<FleetService["vehicleRecord"]>>): Promise<VehicleDetail> {
    const assignment = row.assignments[0];
    return {
      ...toVehicleSummary(
        row,
        assignment?.isPrimary ?? false,
        assignment ? { id: assignment.driverProfile.id, displayName: assignment.driverProfile.user.displayName } : null,
      ),
      createdAt: row.createdAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
      documents: row.documents.map(toDocumentView),
      stats: await this.collectStats({ trip: { vehicleId: row.id } }, row._count.trips),
    };
  }

  private async requireDriver(id: string) {
    const driver = await this.prisma.client.driverProfile.findUnique({ where: { id } });
    if (!driver) {
      throw new FleetError("NOT_FOUND");
    }
    return driver;
  }

  private async assertDriverDocuments(id: string): Promise<void> {
    const documents = await this.prisma.client.complianceDocument.findMany({
      where: { driverProfileId: id, ownerType: "DRIVER" },
    });
    if (!hasValidApprovalDocument(documents, new Date())) {
      throw new FleetError("APPROVAL_BLOCKED");
    }
  }

  private async addDocument(
    actorId: string,
    ownerType: "DRIVER" | "VEHICLE",
    ownerId: string,
    kind: string,
    expiresOn: string | undefined,
  ): Promise<DocumentView> {
    const cleanKind = kind.trim();
    if (cleanKind.length < 2 || cleanKind.length > 80) {
      throw new FleetError("TYPE");
    }
    const expiry = parseDateOnly(expiresOn);
    const created = await this.prisma.client.$transaction(async (tx) => {
      const document = await tx.complianceDocument.create({
        data: {
          ownerType,
          driverProfileId: ownerType === "DRIVER" ? ownerId : null,
          vehicleId: ownerType === "VEHICLE" ? ownerId : null,
          kind: cleanKind,
          expiresOn: expiry,
          status: "PENDING",
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "document.created",
          entityType: "ComplianceDocument",
          entityId: document.id,
          after: { ownerType, ownerId, kind: cleanKind, expiresOn: expiresOn ?? null },
        },
      });
      return document;
    });
    return toDocumentView(created);
  }

  private async reviewDocument(
    actorId: string,
    documentId: string,
    ownerType: "DRIVER" | "VEHICLE",
    status: ReviewStatus,
  ): Promise<DocumentView> {
    const existing = await this.prisma.client.complianceDocument.findUnique({ where: { id: documentId } });
    if (!existing || existing.ownerType !== ownerType) {
      throw new FleetError("NOT_FOUND");
    }
    if (status === "APPROVED" && !hasValidApprovalDocument([{ status: "APPROVED", expiresOn: existing.expiresOn }], new Date())) {
      throw new FleetError("DOCUMENT_EXPIRED");
    }
    const updated = await this.prisma.client.$transaction(async (tx) => {
      const document = await tx.complianceDocument.update({
        where: { id: documentId },
        data: { status, reviewedAt: new Date(), reviewedById: actorId },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "document.reviewed",
          entityType: "ComplianceDocument",
          entityId: documentId,
          before: { status: existing.status },
          after: { status },
        },
      });
      return document;
    });
    return toDocumentView(updated);
  }
}

function toDriverView(row: {
  id: string;
  approvalStatus: string;
  nearbyRadiusMeters: number;
  acceptsNearbyRequests: boolean;
  assignmentBlocked: boolean;
  createdAt: Date;
  deletedAt: Date | null;
  imageUrl: string | null;
  user: { displayName: string; phone: string | null; email: string | null; status: string };
  vehicleAssignments: {
    isPrimary: boolean;
    vehicle: {
      id: string;
      plateNumber: string;
      capacity: number;
      vehicleType: string;
      approvalStatus: string;
      imageUrl: string | null;
      documentUrl: string | null;
    };
  }[];
  _count: { trips: number };
}): DriverView {
  const assignment = row.vehicleAssignments[0];
  return {
    id: row.id,
    displayName: row.user.displayName,
    phone: row.user.phone,
    email: row.user.email,
    userStatus: row.user.status,
    approvalStatus: row.approvalStatus,
    nearbyRadiusMeters: row.nearbyRadiusMeters,
    acceptsNearbyRequests: row.acceptsNearbyRequests,
    assignmentBlocked: row.assignmentBlocked,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    tripCount: row._count.trips,
    imageUrl: row.imageUrl,
    primaryVehicle: assignment
      ? toVehicleSummary(assignment.vehicle, assignment.isPrimary, { id: row.id, displayName: row.user.displayName })
      : null,
  };
}

function toVehicleSummary(
  vehicle: {
    id: string;
    plateNumber: string;
    capacity: number;
    vehicleType: string;
    approvalStatus: string;
    imageUrl: string | null;
    documentUrl: string | null;
  },
  isPrimary: boolean,
  assignedDriver: { id: string; displayName: string } | null = null,
): VehicleSummary {
  return {
    id: vehicle.id,
    plateNumber: vehicle.plateNumber,
    capacity: vehicle.capacity,
    vehicleType: vehicle.vehicleType,
    approvalStatus: vehicle.approvalStatus,
    isPrimary,
    imageUrl: vehicle.imageUrl,
    documentUrl: vehicle.documentUrl,
    assignedDriver,
  };
}

function approvalReason(status: ApprovalStatus, reason: string | undefined): string | null {
  if (status === "APPROVED") {
    return null;
  }
  return assertReason(reason ?? "");
}

function toDocumentView(document: {
  id: string;
  kind: string;
  status: string;
  expiresOn: Date | null;
}): DocumentView {
  return {
    id: document.id,
    kind: document.kind,
    status: document.status,
    expiresOn: document.expiresOn ? document.expiresOn.toISOString().slice(0, 10) : null,
  };
}

function toAreaLinkView(link: {
  id: string;
  serviceAreaId: string;
  preference: string;
  status: string;
  serviceArea: { name: string; kind: string; isActive: boolean };
}): AreaLinkView {
  return {
    id: link.id,
    serviceAreaId: link.serviceAreaId,
    name: link.serviceArea.name,
    kind: link.serviceArea.kind,
    preference: link.preference,
    status: link.status,
    areaActive: link.serviceArea.isActive,
  };
}

function toCents(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  return (negative ? -1n : 1n) * (BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2)));
}

function moneyTotals(totals: Map<string, bigint>): MoneyTotal[] {
  return [...totals.entries()]
    .filter(([, cents]) => cents !== 0n)
    .map(([currency, cents]) => {
      const negative = cents < 0n;
      const abs = negative ? -cents : cents;
      return {
        currency: currency.trim(),
        amount: `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`,
      };
    });
}

function assertName(value: string): string {
  const name = value.trim();
  if (name.length < 2 || name.length > 80) {
    throw new FleetError("NAME");
  }
  return name;
}

function assertReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 300) {
    throw new FleetError("REASON");
  }
  return reason;
}

function prepareVehicle(input: { plateNumber: string; capacity: number; vehicleType: string }): {
  plateNumber: string;
  capacity: number;
  vehicleType: string;
} {
  const plateNumber = normalizePlate(input.plateNumber);
  const vehicleType = input.vehicleType.trim();
  if (vehicleType.length < 2 || vehicleType.length > 40) {
    throw new FleetError("TYPE");
  }
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 20) {
    throw new FleetError("CAPACITY");
  }
  return { plateNumber, capacity: input.capacity, vehicleType };
}

function normalizePlate(value: string): string {
  const plate = value.trim().replace(/\s+/g, " ").toUpperCase();
  if (plate.length < 2 || plate.length > 16) {
    throw new FleetError("PLATE");
  }
  return plate;
}

function parseDateOnly(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new FleetError("DATE");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new FleetError("DATE");
  }
  return date;
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2002";
}
