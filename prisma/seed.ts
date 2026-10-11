import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword, passwordSchema } from "../src/modules/auth/password";
import { seedBase } from "./seed-lib";

/**
 * Usage:
 *   npm run db:seed              base configuration (+ optional initial Super Admin from env)
 *   npm run db:seed -- --demo    also load FICTIONAL demonstration data (never in production)
 *   npm run db:seed -- --reset-roles   restore default role permissions
 *
 * Initial Super Administrator (production): set SEED_SUPER_ADMIN_EMAIL,
 * SEED_SUPER_ADMIN_NAME and SEED_SUPER_ADMIN_PASSWORD for the first run only,
 * then remove them from the environment. The account must enrol MFA at first sign-in.
 */
async function main() {
  const args = new Set(process.argv.slice(2));
  await seedBase(prisma, { resetRoles: args.has("--reset-roles"), log: (m) => console.log(`[seed] ${m}`) });

  const email = process.env.SEED_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (email && password) {
    const pw = passwordSchema.safeParse(password);
    if (!pw.success) throw new Error(`SEED_SUPER_ADMIN_PASSWORD: ${pw.error.issues[0].message}`);
    const exists = await prisma.user.findUnique({ where: { email } });
    if (!exists) {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: "SUPER_ADMIN" } });
      await prisma.user.create({
        data: {
          email, name: process.env.SEED_SUPER_ADMIN_NAME || "Super Administrator", passwordHash: await hashPassword(password),
          userType: "KATDICT_STAFF", status: "ACTIVE", emailVerifiedAt: new Date(), roles: { create: { roleId: role.id } },
        },
      });
      console.log(`[seed] initial Super Administrator created: ${email}`);
    }
  }

  if (args.has("--demo")) {
    if (process.env.NODE_ENV === "production" && !args.has("--allow-demo-in-production")) {
      throw new Error("Refusing to load demo data with NODE_ENV=production.");
    }
    const { seedDemo, DEMO_PASSWORD } = await import("./seed-demo");
    await seedDemo((m) => console.log(`[seed] ${m}`));
    console.log(`[seed] DEMO accounts use password: ${DEMO_PASSWORD} (fictional, *.katdict.test)`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
