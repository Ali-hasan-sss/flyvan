export const directionLabels: Record<string, string> = {
  OUTBOUND: "ذهاب",
  RETURN: "إياب",
  INDEPENDENT: "مستقل",
  ROUND_TRIP: "ذهاب وإياب",
};

export const bookingStatusLabels: Record<string, string> = {
  DRAFT: "مسودة",
  PENDING: "بانتظار التأكيد",
  CONFIRMED: "مؤكد",
  CANCELLED: "ملغى",
};

export const tripStatusLabels: Record<string, string> = {
  PENDING_ASSIGNMENT: "بانتظار الإسناد",
  OFFERED: "معروضة",
  ASSIGNED: "مسندة",
  DRIVER_ARRIVED: "وصل السائق",
  IN_PROGRESS: "قيد التنفيذ",
  COMPLETED: "مكتملة",
  NO_SHOW: "لم يحضر",
  CANCELLED: "ملغاة",
  DISPUTED: "متنازع عليها",
};

export const sourceLabels: Record<string, string> = {
  NEARBY: "قرب",
  SERVICE_AREA: "منطقة خدمة",
  MANUAL_DISPATCH: "إسناد يدوي",
  MATCHING_ENGINE: "محرك المطابقة",
};

export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function formatRoadDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "—";
  if (meters < 1000) return `${Math.round(meters)} م`;
  return `${(meters / 1000).toFixed(1)} كم`;
}

export function formatRoadDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} س` : `${hours} س ${rest} د`;
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ar", { timeStyle: "short" }).format(date);
}

export function formatFare(amount: string | null, currency: string | null): string {
  if (!amount) return "—";
  if (!currency || currency === "SYP") return `${amount} ل.س`;
  return `${amount} ${currency}`;
}

export function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
