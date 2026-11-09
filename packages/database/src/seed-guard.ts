export type SeedAccount = {
  email: string;
  password: string;
};

export type SeedInput = {
  email: string;
  password: string;
  commissionRate: string | null;
  admin: SeedAccount | null;
};

const RATE_PATTERN = /^(?:\d{1,3})(?:\.\d{1,3})?$/;

export function assertSeedAllowed(env: NodeJS.ProcessEnv): SeedInput {
  if (env.NODE_ENV === "production") {
    throw new Error("Refusing to seed when NODE_ENV=production.");
  }
  if (env.SEED_ENABLED !== "true") {
    throw new Error("Refusing to seed unless SEED_ENABLED=true.");
  }

  const email = env.SEED_OWNER_EMAIL?.trim().toLowerCase() ?? "";
  const password = env.SEED_OWNER_PASSWORD ?? "";
  if (!email.includes("@") || password.length < 8) {
    throw new Error(
      "SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD (8+ characters) are required.",
    );
  }

  const admin = readOptionalAccount(env, "SEED_ADMIN_EMAIL", "SEED_ADMIN_PASSWORD");
  if (admin && admin.email.toLowerCase() === email.toLowerCase()) {
    throw new Error("SEED_ADMIN_EMAIL must be different from SEED_OWNER_EMAIL.");
  }

  const rate = env.SEED_DEFAULT_COMMISSION_RATE?.trim() ?? "";
  if (rate.length === 0) {
    return { email, password, commissionRate: null, admin };
  }
  if (!RATE_PATTERN.test(rate)) {
    throw new Error("SEED_DEFAULT_COMMISSION_RATE must be a decimal between 0 and 100.");
  }
  const numeric = Number(rate);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
    throw new Error("SEED_DEFAULT_COMMISSION_RATE must be a decimal between 0 and 100.");
  }

  return { email, password, commissionRate: rate, admin };
}

function readOptionalAccount(
  env: NodeJS.ProcessEnv,
  emailKey: string,
  passwordKey: string,
): SeedAccount | null {
  const accountEmail = env[emailKey]?.trim().toLowerCase() ?? "";
  const accountPassword = env[passwordKey] ?? "";
  if (accountEmail.length === 0 && accountPassword.length === 0) {
    return null;
  }
  if (!accountEmail.includes("@") || accountPassword.length < 8) {
    throw new Error(`${emailKey} and ${passwordKey} (8+ characters) are both required.`);
  }
  return { email: accountEmail, password: accountPassword };
}
