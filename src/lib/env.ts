import { z } from "zod";
import { resolveDatabaseUrl } from "./database-url";

/**
 * Server-side environment configuration. Evaluated lazily so that `next build`
 * does not require production secrets. NEVER import this module from client code.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(60),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),
  EMAIL_PROVIDER: z.enum(["console", "resend", "smtp"]).default("console"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_SECURITY: z.enum(["tls", "starttls", "none"]).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("KATDICT SPIMP <no-reply@localhost>"),
  AI_PROVIDER: z.enum(["disabled", "anthropic"]).default("disabled"),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5-5"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  AI_MAX_CALLS_PER_USER_PER_HOUR: z.coerce.number().int().positive().default(60),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  OBJECT_STORAGE_ENDPOINT: z.string().optional(),
  OBJECT_STORAGE_REGION: z.string().default("auto"),
  OBJECT_STORAGE_BUCKET: z.string().optional(),
  OBJECT_STORAGE_ACCESS_KEY: z.string().optional(),
  OBJECT_STORAGE_SECRET_KEY: z.string().optional(),
  FILE_UPLOAD_MAX_SIZE: z.coerce.number().int().positive().default(4 * 1024 * 1024),
  MALWARE_SCAN_WEBHOOK_URL: z.string().url().optional(),
  CRON_SECRET: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse({ ...process.env, DATABASE_URL: resolveDatabaseUrl() });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === "production") {
    if (e.STORAGE_DRIVER === "local" && process.env.UNSAFE_ALLOW_LOCAL_STORAGE !== "true") {
      throw new Error("STORAGE_DRIVER=local is not permitted in production; configure S3-compatible storage.");
    }
    if (e.AUTH_SECRET.startsWith("dev-only")) {
      throw new Error("A development AUTH_SECRET must not be used in production.");
    }
  }
  cached = e;
  return e;
}

/** For tests only. */
export function resetEnvCache() {
  cached = null;
}
