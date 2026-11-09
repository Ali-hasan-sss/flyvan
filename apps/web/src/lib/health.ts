export type ApiHealth = {
  status: "ok" | "degraded";
  service: string;
  database: "up" | "down";
  phase: string;
};

export type HealthResult =
  | { ok: true; health: ApiHealth }
  | { ok: false; message: string };

export async function fetchApiHealth(): Promise<HealthResult> {
  const base = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

  try {
    const response = await fetch(`${base}/api/health`, { cache: "no-store" });
    if (response.status !== 200 && response.status !== 503) {
      return { ok: false, message: "استجابة فحص الصحة غير متوقعة." };
    }
    const health = (await response.json()) as ApiHealth;
    return { ok: true, health };
  } catch {
    return {
      ok: false,
      message: "الواجهة البرمجية غير متصلة. شغّل خدمة API ثم أعد تحميل الصفحة.",
    };
  }
}
