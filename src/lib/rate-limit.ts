import { prisma } from "@/lib/db";
import { RateLimitError } from "@/lib/errors";

/**
 * Fixed-window rate limiter backed by PostgreSQL so that it works across
 * serverless instances. Uses a single atomic UPSERT per call.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number }> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStart")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${windowSeconds}::double precision) THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${windowSeconds}::double precision) THEN now() ELSE "RateLimitBucket"."windowStart" END
    RETURNING "count"`;
  const count = Number(rows[0]?.count ?? 0);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number, message?: string) {
  const r = await rateLimit(key, limit, windowSeconds);
  if (!r.allowed) throw new RateLimitError(message);
}
