import { AppError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export interface ActionState {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Optional payload for the client (never secrets). */
  data?: Record<string, unknown>;
  /** Incremented on every completion so clients can react to repeated results. */
  ts?: number;
}

export const initialActionState: ActionState = { ok: false };

/**
 * Converts thrown errors into user-safe action results. Unexpected errors are
 * logged and a generic message is returned (no internals leak to the browser).
 * Next.js redirect()/notFound() control-flow errors are re-thrown.
 */
export async function runAction(fn: () => Promise<string | void | { message?: string; data?: Record<string, unknown> }>): Promise<ActionState> {
  try {
    const out = await fn();
    if (typeof out === "string") return { ok: true, message: out, ts: Date.now() };
    return { ok: true, message: out?.message ?? "Saved.", data: out?.data, ts: Date.now() };
  } catch (err) {
    const digest = (err as { digest?: string })?.digest;
    if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND") || digest.startsWith("NEXT_HTTP_ERROR"))) throw err;
    if (err instanceof ValidationError) return { ok: false, message: err.message, fieldErrors: err.fieldErrors, ts: Date.now() };
    if (err instanceof AppError) return { ok: false, message: err.message, ts: Date.now() };
    logger.error("action.unexpected_error", { error: err as Error });
    return { ok: false, message: "Something went wrong. Please try again or contact support.", ts: Date.now() };
  }
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : undefined;
};
export const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === undefined || v === "" ? undefined : Number(v);
};
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
export const obj = (fd: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, str(fd, k)]));
