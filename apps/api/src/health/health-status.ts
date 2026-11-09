export type HealthReport = {
  status: "ok" | "degraded";
  service: "flyvan-api";
  database: "up" | "down";
  phase: "finance";
};

export async function readDatabaseStatus(query: () => Promise<unknown>): Promise<"up" | "down"> {
  try {
    await query();
    return "up";
  } catch {
    return "down";
  }
}

export function healthHttpStatus(report: HealthReport): 200 | 503 {
  return report.status === "ok" ? 200 : 503;
}

export function buildHealthReport(database: "up" | "down"): HealthReport {
  return {
    status: database === "up" ? "ok" : "degraded",
    service: "flyvan-api",
    database,
    phase: "finance",
  };
}
