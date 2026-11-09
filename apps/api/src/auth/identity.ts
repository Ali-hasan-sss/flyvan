const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return null;
  }
  return email;
}

export function normalizePhone(value: string): string | null {
  const compact = value.trim().replace(/[\s-]/g, "");
  const match = /^(\+)?(\d+)$/.exec(compact);
  if (!match) {
    return null;
  }
  const digits = match[2] ?? "";
  if (digits.length < 6 || digits.length > 15) {
    return null;
  }
  return `${match[1] ?? ""}${digits}`;
}

export function parseLoginIdentifier(
  value: string,
): { kind: "email"; value: string } | { kind: "phone"; value: string } | null {
  const trimmed = value.trim();
  if (trimmed.includes("@")) {
    const email = normalizeEmail(trimmed);
    return email ? { kind: "email", value: email } : null;
  }
  const phone = normalizePhone(trimmed);
  return phone ? { kind: "phone", value: phone } : null;
}
