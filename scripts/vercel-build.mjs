// Vercel build entry point (Build Command: `npm run vercel-build`).
// Production deployments apply pending database migrations (never resets data)
// and run the idempotent base seed, which creates the initial Super
// Administrator only if SEED_SUPER_ADMIN_* are set and that user does not exist.
// Preview deployments only build.
import { execSync } from "node:child_process";

const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
};

run("npx prisma generate");
if (process.env.VERCEL_ENV === "production") {
  run("npx prisma migrate deploy");
  run("npx tsx prisma/seed.ts");
} else {
  console.log(`\nVERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}: skipping migrations and seed.`);
}
run("npx next build");
