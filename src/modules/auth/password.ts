import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

// Argon2id parameters per OWASP Password Storage Cheat Sheet (m=19MiB, t=2, p=1).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters")
  .max(128, "Password must be at most 128 characters")
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), {
    message: "Password must include upper-case, lower-case letters and a number",
  });

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string | null | undefined, password: string): Promise<boolean> {
  if (!passwordHash) {
    // Run a dummy verification to keep timing similar for unknown accounts.
    dummyHash ??= await hash("timing-equaliser-not-a-real-password", OPTIONS);
    await verify(dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Computed lazily; used only to equalise timing for unknown accounts.
let dummyHash: string | null = null;
