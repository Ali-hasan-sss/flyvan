import Decimal from "decimal.js";

/**
 * Pending product confirmation. See docs/assumptions.md.
 * commission = fare * rate / 100, half away from zero, two decimal places.
 */
export const COMMISSION_ROUNDING = {
  mode: "HALF_AWAY_FROM_ZERO",
  fareScale: 2,
  rateScale: 3,
  resultScale: 2,
} as const;

const HALF_UP = Decimal.ROUND_HALF_UP;

function assertScale(value: Decimal, scale: number, label: string): void {
  if (value.decimalPlaces() > scale) {
    throw new Error(`${label} must have at most ${scale} decimal places`);
  }
}

export function calculateCommissionAmount(fareAmount: string, ratePercent: string): string {
  const fare = new Decimal(fareAmount);
  const rate = new Decimal(ratePercent);

  if (!fare.isFinite() || fare.isNegative()) {
    throw new Error("fare must be a non-negative decimal");
  }
  if (!rate.isFinite() || rate.isNegative() || rate.greaterThan(100)) {
    throw new Error("commission rate must be between 0 and 100");
  }

  assertScale(fare, COMMISSION_ROUNDING.fareScale, "fare");
  assertScale(rate, COMMISSION_ROUNDING.rateScale, "commission rate");

  return fare
    .mul(rate)
    .div(100)
    .toDecimalPlaces(COMMISSION_ROUNDING.resultScale, HALF_UP)
    .toFixed(COMMISSION_ROUNDING.resultScale);
}

export type PaymentObligation = {
  id: string;
  remaining: string;
};

/** Applies a payment to the oldest remaining obligations. Anything left is unapplied credit. */
export function allocatePayment(
  obligations: readonly PaymentObligation[],
  payment: string,
): { allocations: { id: string; amount: string }[]; unapplied: string } {
  const amount = new Decimal(payment);
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0)) {
    throw new Error("payment must be a positive decimal");
  }
  assertScale(amount, COMMISSION_ROUNDING.resultScale, "payment");

  let left = amount;
  const allocations: { id: string; amount: string }[] = [];
  for (const obligation of obligations) {
    if (left.lessThanOrEqualTo(0)) break;
    const remaining = new Decimal(obligation.remaining);
    if (!remaining.isFinite() || remaining.lessThanOrEqualTo(0)) continue;
    const take = Decimal.min(left, remaining).toDecimalPlaces(COMMISSION_ROUNDING.resultScale, HALF_UP);
    if (take.lessThanOrEqualTo(0)) continue;
    allocations.push({ id: obligation.id, amount: take.toFixed(COMMISSION_ROUNDING.resultScale) });
    left = left.minus(take);
  }
  return {
    allocations,
    unapplied: left.toDecimalPlaces(COMMISSION_ROUNDING.resultScale, HALF_UP).toFixed(COMMISSION_ROUNDING.resultScale),
  };
}
