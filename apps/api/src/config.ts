export type ApiConfig = {
  databaseUrl: string;
  port: number;
  webOrigin: string;
  accessTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
};

export function readApiConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  }

  const port = Number(env.API_PORT ?? "3001");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("API_PORT must be an integer between 1 and 65535.");
  }

  const accessTokenSecret = env.JWT_ACCESS_SECRET?.trim() ?? "";
  if (accessTokenSecret.length < 32) {
    throw new Error("JWT_ACCESS_SECRET must be at least 32 characters.");
  }

  return {
    databaseUrl,
    port,
    webOrigin: env.WEB_ORIGIN?.trim() || "http://localhost:3000",
    accessTokenSecret,
    accessTokenTtlSeconds: readTtl(env.ACCESS_TOKEN_TTL_SECONDS, 900, "ACCESS_TOKEN_TTL_SECONDS"),
    refreshTokenTtlSeconds: readTtl(env.REFRESH_TOKEN_TTL_SECONDS, 1_209_600, "REFRESH_TOKEN_TTL_SECONDS"),
  };
}

function readTtl(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 60 || parsed > 7_776_000) {
    throw new Error(`${name} must be a whole number of seconds from 60 to 7776000.`);
  }
  return parsed;
}
