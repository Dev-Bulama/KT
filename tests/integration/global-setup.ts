import { execSync } from "node:child_process";

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://katdict:katdict@localhost:5432/katdict_test";
  if (/prod/i.test(url)) throw new Error("Refusing to run integration tests against a database that looks like production.");
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url } });
}
