import "dotenv/config";
import { defineConfig } from "prisma/config";

// Migrations use the direct (non-pooled) connection when available
// (DIRECT_URL, or the names added by Vercel's Neon integration).
// Runtime queries use DATABASE_URL via the pg driver adapter (src/lib/db.ts).
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL || process.env.POSTGRES_URL || "",
  },
});
