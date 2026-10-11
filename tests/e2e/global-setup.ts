import { execSync } from "node:child_process";
import pg from "pg";

export const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://katdict:katdict@localhost:5432/katdict_e2e";

/** Resets the E2E database and seeds base configuration plus fictional KATDICT staff accounts. */
export default async function globalSetup() {
  if (/prod/i.test(E2E_DB)) throw new Error("Refusing to reset a database that looks like production.");
  const env = { ...process.env, DATABASE_URL: E2E_DB, DIRECT_URL: E2E_DB, AUTH_SECRET: "e2e-only-secret-0123456789abcdef0123456789abcdef" };
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  const client = new pg.Client({ connectionString: E2E_DB });
  await client.connect();
  const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'");
  await client.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await client.end();
  execSync("npx tsx tests/e2e/seed-e2e.ts", { stdio: "inherit", env });
}
