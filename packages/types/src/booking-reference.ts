const REFERENCE_PATTERN = /^FV-\d{8}-\d{4,}$/;

export function formatBookingReference(date: Date, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("sequence must be a positive integer");
  }

  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  const suffix = sequence.toString().padStart(4, "0");
  return `FV-${year}${month}${day}-${suffix}`;
}

export function isBookingReference(value: string): boolean {
  return REFERENCE_PATTERN.test(value);
}
