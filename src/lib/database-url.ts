/**
 * Runtime (pooled) database URL. DATABASE_URL is preferred; the names added
 * by Vercel's Postgres/Neon integrations are accepted as fallbacks.
 */
export function resolveDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL || undefined;
}
