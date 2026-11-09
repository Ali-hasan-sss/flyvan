import path from "node:path";
import argon2 from "argon2";
import { config as loadEnv } from "dotenv";
import { ROLE_PERMISSIONS, USER_ROLES } from "@flyvan/types";
import { createPrismaClient } from "../src/client";
import { assertSeedAllowed } from "../src/seed-guard";

for (const candidate of [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
]) {
  loadEnv({ path: candidate });
}

async function main(): Promise<void> {
  const input = assertSeedAllowed(process.env);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const prisma = createPrismaClient(databaseUrl);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany();
      await tx.rolePermission.createMany({
        data: USER_ROLES.flatMap((role) =>
          ROLE_PERMISSIONS[role].map((permission) => ({ role, permission })),
        ),
      });
    });

    const owner = await ensureUser(prisma, {
      email: input.email,
      password: input.password,
      displayName: "مالك المنصة (تطوير)",
      role: "PLATFORM_OWNER",
    });

    if (input.admin) {
      await ensureUser(prisma, {
        email: input.admin.email,
        password: input.admin.password,
        displayName: "مدير العمليات (تطوير)",
        role: "ADMIN",
      });
    } else {
      console.log("No SEED_ADMIN_EMAIL set. No operations admin was created.");
    }

    if (input.commissionRate) {
      const policies = await prisma.commissionPolicy.count();
      if (policies === 0) {
        await prisma.commissionPolicy.create({
          data: {
            ratePercent: input.commissionRate,
            effectiveFrom: new Date(),
            reason: "Development seed only. Confirm the rate before operations.",
            createdById: owner.id,
          },
        });
        console.log("Created a development commission policy.");
      } else {
        console.log("Commission policy already exists. Seed did not change it.");
      }
    } else {
      console.log("No SEED_DEFAULT_COMMISSION_RATE set. No commission policy was created.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function ensureUser(
  prisma: ReturnType<typeof createPrismaClient>,
  input: { email: string; password: string; displayName: string; role: "PLATFORM_OWNER" | "ADMIN" },
) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    console.log(`${input.role} already exists. Password was left unchanged.`);
    return existing;
  }

  const created = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
      displayName: input.displayName,
      role: input.role,
      status: "ACTIVE",
    },
  });
  console.log(`Created the development ${input.role} account.`);
  return created;
}
