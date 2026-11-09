import { Injectable } from "@nestjs/common";
import { allocatePayment, calculateCommissionAmount, type Permission } from "@flyvan/types";
import Decimal from "decimal.js";
import type { PublicUser } from "../auth/public-user";
import { PrismaService } from "../prisma/prisma.service";
import { PLATFORM_CURRENCY } from "../operations/operations.rules";
import { FinanceError } from "./finance.errors";

const OPEN_ASSIGNMENT = ["ASSIGNED", "DRIVER_ARRIVED", "IN_PROGRESS"] as const;

type Tx = Parameters<Parameters<PrismaService["client"]["$transaction"]>[0]>[0];

type MoneyRow = { amount: { toString(): string }; direction: "DEBIT" | "CREDIT" };

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(actor: PublicUser) {
    await this.assertAny(actor, ["FINANCE_VIEW"]);
    const [policy, drivers, ledger, settlements] = await Promise.all([
      this.currentPolicy(this.prisma.client, new Date()),
      this.prisma.client.driverProfile.findMany({
        where: { deletedAt: null },
        include: {
          user: { select: { displayName: true } },
          financialAccounts: true,
          commissionOverrides: { orderBy: { effectiveFrom: "desc" }, take: 1 },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      this.prisma.client.ledgerEntry.findMany({
        select: { driverProfileId: true, currency: true, direction: true, amount: true, type: true },
      }),
      this.prisma.client.settlement.findMany({
        orderBy: { createdAt: "desc" },
        take: 40,
        include: { driverProfile: { include: { user: { select: { displayName: true } } } } },
      }),
    ]);
    const balances = new Map<string, Decimal>();
    const settled = new Map<string, Decimal>();
    for (const entry of ledger) {
      const key = `${entry.driverProfileId}:${entry.currency}`;
      const amount = new Decimal(entry.amount.toString());
      const current = balances.get(key) ?? new Decimal(0);
      balances.set(key, entry.direction === "DEBIT" ? current.plus(amount) : current.minus(amount));
      if (entry.direction === "CREDIT" && entry.type === "DRIVER_PAYMENT") {
        settled.set(key, (settled.get(key) ?? new Decimal(0)).plus(amount));
      }
    }
    let companyOutstanding = new Decimal(0);
    const accounts = drivers.flatMap((driver) => {
      const rows = driver.financialAccounts.length > 0 ? driver.financialAccounts : [null];
      return rows.map((account) => {
        const currency = account?.currency ?? PLATFORM_CURRENCY;
        const key = `${driver.id}:${currency}`;
        const outstanding = balances.get(key) ?? new Decimal(0);
        if (currency === PLATFORM_CURRENCY) companyOutstanding = companyOutstanding.plus(outstanding);
        return {
          driverProfileId: driver.id,
          driverName: driver.user.displayName,
          currency,
          creditLimitAmount: account ? this.money(account.creditLimitAmount.toString()) : null,
          ratePercent: driver.commissionOverrides[0] ? this.rate(driver.commissionOverrides[0].ratePercent.toString()) : null,
          outstanding: outstanding.toFixed(2),
          settled: (settled.get(key) ?? new Decimal(0)).toFixed(2),
        };
      });
    });
    return {
      currency: PLATFORM_CURRENCY,
      companyOutstanding: companyOutstanding.toFixed(2),
      companyOutstandingNote: "إجمالي تجميعي لمستحقات الشركة. ليس حدًا يوقف السائقين.",
      policy: policy
        ? { ratePercent: this.rate(policy.ratePercent.toString()), effectiveFrom: policy.effectiveFrom.toISOString() }
        : null,
      accounts,
      settlements: settlements.map((row) => ({
        id: row.id,
        driverProfileId: row.driverProfileId,
        driverName: row.driverProfile.user.displayName,
        amount: this.money(row.amount.toString()),
        currency: row.currency,
        method: row.method,
        receivedAt: row.receivedAt.toISOString(),
        receiptNumber: row.receiptNumber,
        status: row.status.toString(),
      })),
    };
  }

  async ownSummary(actor: PublicUser) {
    await this.assertAny(actor, ["OWN_FINANCE_VIEW"]);
    const driver = await this.prisma.client.driverProfile.findUnique({ where: { userId: actor.id } });
    if (!driver) throw new FinanceError("NOT_FOUND");
    const [entries, commissions, settlements, account] = await Promise.all([
      this.prisma.client.ledgerEntry.findMany({ where: { driverProfileId: driver.id, currency: PLATFORM_CURRENCY } }),
      this.prisma.client.tripCommission.findMany({
        where: { driverProfileId: driver.id },
        orderBy: { accruedAt: "desc" },
        take: 20,
        include: { trip: { select: { reference: true } } },
      }),
      this.prisma.client.settlement.findMany({
        where: { driverProfileId: driver.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      this.prisma.client.driverFinancialAccount.findUnique({
        where: { driverProfileId_currency: { driverProfileId: driver.id, currency: PLATFORM_CURRENCY } },
      }),
    ]);
    const outstanding = this.balanceOf(entries);
    const creditLimitAmount = account ? this.money(account.creditLimitAmount.toString()) : null;
    const creditNotice = !account
      ? "لا يوجد حد ائتماني. لن تُقبل إسنادات جديدة حتى يعيّنه مالك المنصة."
      : outstanding.greaterThanOrEqualTo(account.creditLimitAmount.toString())
        ? "بلغت حد المديونية. لن تُقبل إسنادات جديدة حتى يُسدَّد جزء من العمولة."
        : null;
    return {
      currency: PLATFORM_CURRENCY,
      outstanding: outstanding.toFixed(2),
      creditLimitAmount,
      creditNotice,
      cashFareNote: "أجرة الراكب التي تستلمها نقدًا ليست تسديدًا لعمولة الشركة.",
      commissions: commissions.map((row) => ({
        id: row.id,
        tripReference: row.trip.reference,
        fareAmount: this.money(row.fareAmount.toString()),
        ratePercent: this.rate(row.commissionRateApplied.toString()),
        commissionAmount: this.money(row.commissionAmount.toString()),
        status: row.status.toString(),
        accruedAt: row.accruedAt.toISOString(),
      })),
      settlements: settlements.map((row) => ({
        id: row.id,
        amount: this.money(row.amount.toString()),
        receiptNumber: row.receiptNumber,
        status: row.status.toString(),
        receivedAt: row.receivedAt.toISOString(),
      })),
    };
  }

  async setPolicy(actor: PublicUser, input: { ratePercent: string; effectiveFrom: string; reason: string }) {
    await this.assertAny(actor, ["COMMISSION_POLICY_MANAGE"]);
    const rate = this.parseRate(input.ratePercent);
    const effectiveFrom = this.parseWhen(input.effectiveFrom);
    const reason = this.parseReason(input.reason);
    const saved = await this.prisma.client.$transaction(async (tx) => {
      const current = await this.currentPolicy(tx, effectiveFrom);
      if (current && current.effectiveFrom.getTime() >= effectiveFrom.getTime()) {
        throw new FinanceError("STATE", "تاريخ السريان يجب أن يكون بعد السياسة المفتوحة.");
      }
      if (current) {
        await tx.commissionPolicy.update({ where: { id: current.id }, data: { effectiveTo: effectiveFrom } });
      }
      const created = await tx.commissionPolicy.create({
        data: { ratePercent: rate, effectiveFrom, reason, createdById: actor.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "commission_policy.created",
          entityType: "CommissionPolicy",
          entityId: created.id,
          reason,
          before: current ? { ratePercent: current.ratePercent.toString(), effectiveTo: null } : undefined,
          after: { ratePercent: rate, effectiveFrom: effectiveFrom.toISOString() },
        },
      });
      return created;
    });
    return { id: saved.id, ratePercent: this.rate(saved.ratePercent.toString()), effectiveFrom: saved.effectiveFrom.toISOString() };
  }

  async setDriverRate(
    actor: PublicUser,
    driverProfileId: string,
    input: { ratePercent: string; effectiveFrom: string; reason: string },
  ) {
    await this.assertAny(actor, ["DRIVER_COMMISSION_MANAGE"]);
    const driver = await this.prisma.client.driverProfile.findFirst({ where: { id: driverProfileId, deletedAt: null } });
    if (!driver) throw new FinanceError("NOT_FOUND");
    const rate = this.parseRate(input.ratePercent);
    const effectiveFrom = this.parseWhen(input.effectiveFrom);
    const reason = this.parseReason(input.reason);
    const saved = await this.prisma.client.$transaction(async (tx) => {
      const current = await tx.driverCommissionOverride.findFirst({
        where: {
          driverProfileId,
          effectiveFrom: { lte: effectiveFrom },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
        },
        orderBy: { effectiveFrom: "desc" },
      });
      if (current) {
        await tx.driverCommissionOverride.update({ where: { id: current.id }, data: { effectiveTo: effectiveFrom } });
      }
      const created = await tx.driverCommissionOverride.create({
        data: { driverProfileId, ratePercent: rate, effectiveFrom, reason, createdById: actor.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "driver_commission.created",
          entityType: "DriverCommissionOverride",
          entityId: created.id,
          reason,
          before: current ? { ratePercent: current.ratePercent.toString() } : undefined,
          after: { driverProfileId, ratePercent: rate, effectiveFrom: effectiveFrom.toISOString() },
        },
      });
      return created;
    });
    return { id: saved.id, driverProfileId, ratePercent: this.rate(saved.ratePercent.toString()), effectiveFrom: saved.effectiveFrom.toISOString() };
  }

  async setCreditLimit(actor: PublicUser, driverProfileId: string, input: { amount: string; reason: string }) {
    await this.assertAny(actor, ["CREDIT_LIMIT_MANAGE"]);
    const driver = await this.prisma.client.driverProfile.findFirst({ where: { id: driverProfileId, deletedAt: null } });
    if (!driver) throw new FinanceError("NOT_FOUND");
    const amount = this.parseMoney(input.amount, true);
    const reason = this.parseReason(input.reason);
    const saved = await this.prisma.client.$transaction(async (tx) => {
      const existing = await tx.driverFinancialAccount.findUnique({
        where: { driverProfileId_currency: { driverProfileId, currency: PLATFORM_CURRENCY } },
      });
      const account = existing
        ? await tx.driverFinancialAccount.update({ where: { id: existing.id }, data: { creditLimitAmount: amount } })
        : await tx.driverFinancialAccount.create({
            data: { driverProfileId, currency: PLATFORM_CURRENCY, creditLimitAmount: amount },
          });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "credit_limit.updated",
          entityType: "DriverFinancialAccount",
          entityId: account.id,
          reason,
          before: existing ? { creditLimitAmount: existing.creditLimitAmount.toString(), currency: PLATFORM_CURRENCY } : undefined,
          after: { driverProfileId, creditLimitAmount: amount, currency: PLATFORM_CURRENCY },
        },
      });
      return account;
    });
    return {
      id: saved.id,
      driverProfileId,
      currency: saved.currency,
      creditLimitAmount: this.money(saved.creditLimitAmount.toString()),
    };
  }

  async grantCreditException(actor: PublicUser, tripId: string, reason: string) {
    await this.assertAny(actor, ["CREDIT_EXCEPTION_GRANT"]);
    const clean = this.parseReason(reason);
    const trip = await this.prisma.client.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new FinanceError("NOT_FOUND");
    if (["COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED"].includes(trip.status)) {
      throw new FinanceError("STATE", "لا يُمنح الاستثناء بعد انتهاء الرحلة.");
    }
    await this.prisma.client.$transaction(async (tx) => {
      await tx.trip.update({
        where: { id: tripId },
        data: { creditExceptionReason: clean, creditExceptionById: actor.id },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "trip.credit_exception_granted",
          entityType: "Trip",
          entityId: tripId,
          reason: clean,
          before: { creditExceptionReason: trip.creditExceptionReason },
          after: { creditExceptionReason: clean },
        },
      });
    });
    return { updated: true };
  }

  async recordSettlement(
    actor: PublicUser,
    input: { driverProfileId: string; amount: string; method: string; receivedAt: string; receiptNumber: string; idempotencyKey: string },
  ) {
    await this.assertAny(actor, ["FINANCE_RECORD_PAYMENT"]);
    const amount = this.parseMoney(input.amount, false);
    const receivedAt = this.parseWhen(input.receivedAt);
    const driver = await this.prisma.client.driverProfile.findFirst({ where: { id: input.driverProfileId, deletedAt: null } });
    if (!driver) throw new FinanceError("NOT_FOUND");
    const existing = await this.prisma.client.settlement.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (!new Decimal(existing.amount.toString()).equals(amount) || existing.driverProfileId !== input.driverProfileId) {
        throw new FinanceError("DUPLICATE", "مفتاح منع التكرار مستخدم لدفعة مختلفة.");
      }
      return this.settlementView(existing);
    }
    try {
      const saved = await this.prisma.client.settlement.create({
        data: {
          driverProfileId: input.driverProfileId,
          amount,
          currency: PLATFORM_CURRENCY,
          method: input.method.trim(),
          receivedAt,
          receiptNumber: input.receiptNumber.trim(),
          idempotencyKey: input.idempotencyKey.trim(),
          receivedById: actor.id,
          status: "RECORDED",
        },
      });
      await this.prisma.client.auditLog.create({
        data: {
          actorId: actor.id,
          action: "settlement.recorded",
          entityType: "Settlement",
          entityId: saved.id,
          after: { amount, currency: PLATFORM_CURRENCY, receiptNumber: saved.receiptNumber, status: "RECORDED" },
        },
      });
      return this.settlementView(saved);
    } catch (error) {
      if (this.isUniqueConflict(error)) throw new FinanceError("DUPLICATE");
      throw error;
    }
  }

  async reviewSettlement(actor: PublicUser, settlementId: string, decision: "PENDING_REVIEW" | "REJECTED", note?: string) {
    await this.assertAny(actor, ["FINANCE_REVIEW_SETTLEMENT"]);
    const cleanNote = note?.trim() || null;
    if (decision === "REJECTED" && (!cleanNote || cleanNote.length < 3)) throw new FinanceError("REASON");
    const saved = await this.prisma.client.$transaction(async (tx) => {
      const current = await tx.settlement.findUnique({ where: { id: settlementId } });
      if (!current) throw new FinanceError("NOT_FOUND");
      if (current.status !== "RECORDED" && current.status !== "PENDING_REVIEW") throw new FinanceError("STATE");
      const updated = await tx.settlement.update({
        where: { id: settlementId },
        data: { status: decision, reviewNote: cleanNote, reviewedById: actor.id, reviewedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "settlement.reviewed",
          entityType: "Settlement",
          entityId: settlementId,
          reason: cleanNote,
          before: { status: current.status },
          after: { status: decision },
        },
      });
      return updated;
    });
    return this.settlementView(saved);
  }

  async approveSettlement(actor: PublicUser, settlementId: string) {
    await this.assertAny(actor, ["FINANCE_APPROVE_SETTLEMENT"]);
    const saved = await this.prisma.client.$transaction(async (tx) => {
      const current = await tx.settlement.findUnique({ where: { id: settlementId } });
      if (!current) throw new FinanceError("NOT_FOUND");
      if (current.status === "APPROVED") return current;
      if (current.status !== "RECORDED" && current.status !== "PENDING_REVIEW") throw new FinanceError("STATE");
      await tx.$queryRawUnsafe(`SELECT "id" FROM "Settlement" WHERE "id" = $1::uuid FOR UPDATE`, settlementId);
      const locked = await tx.settlement.findUnique({ where: { id: settlementId } });
      if (!locked || (locked.status !== "RECORDED" && locked.status !== "PENDING_REVIEW")) throw new FinanceError("STATE");
      const updated = await tx.settlement.update({
        where: { id: settlementId },
        data: { status: "APPROVED", reviewedById: actor.id, reviewedAt: new Date() },
      });
      await tx.ledgerEntry.create({
        data: {
          driverProfileId: locked.driverProfileId,
          currency: locked.currency,
          amount: locked.amount.toString(),
          direction: "CREDIT",
          type: "DRIVER_PAYMENT",
          idempotencyKey: `settlement:${locked.id}`,
          settlementId: locked.id,
          createdById: actor.id,
          reason: `إيصال ${locked.receiptNumber}`,
        },
      });
      await this.allocateApprovedPayment(tx, locked);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "settlement.approved",
          entityType: "Settlement",
          entityId: settlementId,
          before: { status: locked.status },
          after: { status: "APPROVED", amount: locked.amount.toString(), currency: locked.currency },
        },
      });
      return updated;
    });
    return this.settlementView(saved);
  }

  async assertAssignmentCredit(tx: Tx, input: { driverProfileId: string; tripId: string }): Promise<void> {
    const account = await tx.driverFinancialAccount.findUnique({
      where: { driverProfileId_currency: { driverProfileId: input.driverProfileId, currency: PLATFORM_CURRENCY } },
    });
    if (!account) {
      throw new FinanceError("ACCOUNT", "لا يوجد حد ائتماني للسائق بالليرة السورية. عيّنه قبل الإسناد.");
    }
    await tx.$queryRawUnsafe(`SELECT "id" FROM "DriverFinancialAccount" WHERE "id" = $1::uuid FOR UPDATE`, account.id);
    const trip = await tx.trip.findUnique({
      where: { id: input.tripId },
      select: { creditExceptionReason: true, creditExceptionById: true },
    });
    const at = new Date();
    const rate = await this.resolveRate(tx, input.driverProfileId, at);
    const posted = this.balanceOf(
      await tx.ledgerEntry.findMany({
        where: { driverProfileId: input.driverProfileId, currency: PLATFORM_CURRENCY },
        select: { amount: true, direction: true },
      }),
    );
    const openTrips = await tx.trip.findMany({
      where: {
        driverProfileId: input.driverProfileId,
        id: { not: input.tripId },
        status: { in: [...OPEN_ASSIGNMENT] },
        commission: { is: null },
      },
      select: { id: true },
    });
    let projected = posted;
    const fareRows = [input.tripId, ...openTrips.map((row) => row.id)];
    for (const tripId of fareRows) {
      const fare = await this.assignmentFare(tx, tripId);
      if (fare.lessThanOrEqualTo(0)) continue;
      if (!rate) throw new FinanceError("RATE", "لا توجد نسبة عمولة سارية لهذا السائق.");
      projected = projected.plus(calculateCommissionAmount(fare.toFixed(2), rate));
    }
    const limit = new Decimal(account.creditLimitAmount.toString());
    const exempt = Boolean(trip?.creditExceptionById && (trip.creditExceptionReason?.trim().length ?? 0) >= 3);
    const blocked = posted.greaterThanOrEqualTo(limit) || projected.greaterThan(limit);
    if (blocked && !exempt) {
      throw new FinanceError("LIMIT", "الإسناد يتجاوز حد مديونية هذا السائق. بقية السائقين لا يتوقفون.");
    }
  }

  async accrueCompletedTrip(tx: Tx, tripId: string, actorId: string): Promise<void> {
    const existing = await tx.tripCommission.findUnique({ where: { tripId } });
    if (existing) return;
    const trip = await tx.trip.findUnique({
      where: { id: tripId },
      select: { id: true, status: true, driverProfileId: true },
    });
    if (!trip || trip.status !== "COMPLETED" || !trip.driverProfileId) return;
    const seats = await tx.tripPassenger.findMany({
      where: { tripId, boardingStatus: "BOARDED" },
      select: { fareAmount: true, fareCurrency: true },
    });
    let fare = new Decimal(0);
    for (const seat of seats) {
      if (!seat.fareAmount) continue;
      if (seat.fareCurrency && seat.fareCurrency !== PLATFORM_CURRENCY) {
        throw new FinanceError("AMOUNT", "أجرة المقعد بعملة مختلفة ولا تُجمع مع الليرة السورية.");
      }
      fare = fare.plus(seat.fareAmount.toString());
    }
    if (fare.lessThanOrEqualTo(0)) return;
    const rate = await this.resolveRate(tx, trip.driverProfileId, new Date());
    if (!rate) throw new FinanceError("RATE", "لا يمكن اعتماد الرحلة قبل تحديد نسبة العمولة.");
    const commission = calculateCommissionAmount(fare.toFixed(2), rate);
    const created = await tx.tripCommission.create({
      data: {
        tripId,
        driverProfileId: trip.driverProfileId,
        fareAmount: fare.toFixed(2),
        commissionRateApplied: rate,
        commissionAmount: commission,
        currency: PLATFORM_CURRENCY,
        status: commission === "0.00" ? "PAID" : "DUE",
      },
    });
    if (commission !== "0.00") {
      await tx.ledgerEntry.create({
        data: {
          driverProfileId: trip.driverProfileId,
          currency: PLATFORM_CURRENCY,
          amount: commission,
          direction: "DEBIT",
          type: "COMMISSION_ACCRUAL",
          idempotencyKey: `commission:${tripId}`,
          tripCommissionId: created.id,
          createdById: actorId,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId,
        action: "trip_commission.accrued",
        entityType: "TripCommission",
        entityId: created.id,
        after: { tripId, fareAmount: fare.toFixed(2), ratePercent: rate, commissionAmount: commission, currency: PLATFORM_CURRENCY },
      },
    });
  }

  private async allocateApprovedPayment(
    tx: Tx,
    settlement: { id: string; driverProfileId: string; currency: string; amount: { toString(): string } },
  ): Promise<void> {
    const open = await tx.tripCommission.findMany({
      where: {
        driverProfileId: settlement.driverProfileId,
        currency: settlement.currency,
        status: { in: ["DUE", "PARTIALLY_PAID"] },
      },
      orderBy: { accruedAt: "asc" },
      include: { allocations: { select: { amount: true } } },
    });
    const obligations = open.map((row) => {
      const paid = row.allocations.reduce((sum, item) => sum.plus(item.amount.toString()), new Decimal(0));
      return { id: row.id, remaining: new Decimal(row.commissionAmount.toString()).minus(paid).toFixed(2) };
    });
    const plan = allocatePayment(obligations, this.money(settlement.amount.toString()));
    for (const allocation of plan.allocations) {
      await tx.settlementAllocation.create({
        data: {
          settlementId: settlement.id,
          tripCommissionId: allocation.id,
          amount: allocation.amount,
          currency: settlement.currency,
        },
      });
      const source = open.find((row) => row.id === allocation.id);
      if (!source) continue;
      const paidBefore = source.allocations.reduce((sum, item) => sum.plus(item.amount.toString()), new Decimal(0));
      const paidNow = paidBefore.plus(allocation.amount);
      const full = new Decimal(source.commissionAmount.toString());
      await tx.tripCommission.update({
        where: { id: allocation.id },
        data: { status: paidNow.greaterThanOrEqualTo(full) ? "PAID" : "PARTIALLY_PAID" },
      });
    }
  }

  private async assignmentFare(tx: Tx, tripId: string): Promise<Decimal> {
    const seats = await tx.tripPassenger.findMany({
      where: { tripId, boardingStatus: { notIn: ["CANCELLED", "NO_SHOW"] } },
      select: { fareAmount: true, fareCurrency: true },
    });
    let total = new Decimal(0);
    for (const seat of seats) {
      if (!seat.fareAmount) continue;
      if (seat.fareCurrency && seat.fareCurrency !== PLATFORM_CURRENCY) {
        throw new FinanceError("AMOUNT", "لا يُجمع تقدير الحد بين عملات مختلفة.");
      }
      total = total.plus(seat.fareAmount.toString());
    }
    return total;
  }

  private async resolveRate(tx: Tx, driverProfileId: string, at: Date): Promise<string | null> {
    const override = await tx.driverCommissionOverride.findFirst({
      where: {
        driverProfileId,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
    if (override) return this.rate(override.ratePercent.toString());
    const policy = await this.currentPolicy(tx, at);
    return policy ? this.rate(policy.ratePercent.toString()) : null;
  }

  private currentPolicy(db: Tx | PrismaService["client"], at: Date) {
    return db.commissionPolicy.findFirst({
      where: { effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
      orderBy: { effectiveFrom: "desc" },
    });
  }

  private balanceOf(entries: MoneyRow[]): Decimal {
    return entries.reduce((sum, entry) => {
      const amount = new Decimal(entry.amount.toString());
      return entry.direction === "DEBIT" ? sum.plus(amount) : sum.minus(amount);
    }, new Decimal(0));
  }

  private async assertAny(actor: PublicUser, required: Permission[]): Promise<void> {
    const rows = await this.prisma.client.rolePermission.findMany({ where: { role: actor.role } });
    const granted = new Set(rows.map((row) => row.permission));
    if (!required.every((permission) => granted.has(permission))) throw new FinanceError("FORBIDDEN");
  }

  private parseRate(value: string): string {
    try {
      const normalized = new Decimal(value).toFixed(3);
      calculateCommissionAmount("1.00", normalized);
      return normalized;
    } catch {
      throw new FinanceError("AMOUNT", "نسبة العمولة يجب أن تكون بين 0 و100 وبثلاث منازل كحد أقصى.");
    }
  }

  private parseMoney(value: string, allowZero: boolean): string {
    try {
      const amount = new Decimal(value);
      if (!amount.isFinite() || amount.isNegative() || (!allowZero && amount.lessThanOrEqualTo(0)) || amount.decimalPlaces() > 2) {
        throw new Error("invalid");
      }
      return amount.toFixed(2);
    } catch {
      throw new FinanceError("AMOUNT", "المبلغ يجب أن يكون أكبر من صفر وبمنزلتين عشريتين كحد أقصى.");
    }
  }

  private parseWhen(value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) throw new FinanceError("AMOUNT", "التاريخ غير صالح.");
    return parsed;
  }

  private parseReason(value: string): string {
    const clean = value.trim();
    if (clean.length < 3 || clean.length > 300) throw new FinanceError("REASON");
    return clean;
  }

  private money(value: string): string {
    return new Decimal(value).toFixed(2);
  }

  private rate(value: string): string {
    return new Decimal(value).toFixed(3);
  }

  private settlementView(row: {
    id: string;
    driverProfileId: string;
    amount: { toString(): string };
    currency: string;
    method: string;
    receivedAt: Date;
    receiptNumber: string;
    status: string;
  }) {
    return {
      id: row.id,
      driverProfileId: row.driverProfileId,
      amount: this.money(row.amount.toString()),
      currency: row.currency,
      method: row.method,
      receivedAt: row.receivedAt.toISOString(),
      receiptNumber: row.receiptNumber,
      status: row.status,
    };
  }

  private isUniqueConflict(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
  }
}
