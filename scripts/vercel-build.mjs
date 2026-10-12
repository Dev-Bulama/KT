// Vercel build entry point (Build Command: `npm run vercel-build`).
// Production deployments apply pending database migrations (never resets data)
// and run the idempotent base seed, which creates the initial Super
// Administrator only if SEED_SUPER_ADMIN_* are set and that user does not exist.
// Preview deployments only build.
import { execSync } from "node:child_process";

const env = process.env;
const isProduction = env.VERCEL_ENV === "production";

// ---- Preflight: explain missing configuration in plain words -------------
const problems = [];
const dbUrl = env.DATABASE_URL || env.POSTGRES_PRISMA_URL || env.POSTGRES_URL;
if (!dbUrl) {
  problems.push(
    "No database is connected. In Vercel open Storage → (your Neon database) → Connect Project, " +
      "tick Production and Preview, leave Custom Prefix empty, then redeploy. " +
      "(Or add DATABASE_URL yourself in Settings → Environment Variables.)",
  );
}
if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
  problems.push("AUTH_SECRET is missing or shorter than 32 characters. Add it in Settings → Environment Variables (any long random text).");
}
if (env.SEED_SUPER_ADMIN_EMAIL && !env.SEED_SUPER_ADMIN_PASSWORD) {
  problems.push("SEED_SUPER_ADMIN_EMAIL is set but SEED_SUPER_ADMIN_PASSWORD is missing.");
}
if (env.SEED_SUPER_ADMIN_PASSWORD) {
  const p = env.SEED_SUPER_ADMIN_PASSWORD;
  if (p.length < 12 || !/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p)) {
    problems.push("SEED_SUPER_ADMIN_PASSWORD must be at least 12 characters and include upper-case, lower-case letters and a number.");
  }
}
if (env.STORAGE_DRIVER === "s3" && !env.OBJECT_STORAGE_BUCKET) {
  problems.push("STORAGE_DRIVER=s3 but OBJECT_STORAGE_BUCKET is missing. Either add the OBJECT_STORAGE_* variables or delete STORAGE_DRIVER to store files in the database.");
}
if (isProduction && problems.length) {
  console.error("\n==================== CONFIGURATION NEEDED ====================");
  for (const [i, p] of problems.entries()) console.error(`${i + 1}. ${p}`);
  console.error("===============================================================\n");
  process.exit(1);
}

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
};

run("npx prisma generate");
if (isProduction) {
  run("npx prisma migrate deploy");
  run("npx tsx prisma/seed.ts");
} else {
  console.log(`\nVERCEL_ENV=${env.VERCEL_ENV ?? "unset"}: skipping migrations and seed.`);
}
run("npx next build");
