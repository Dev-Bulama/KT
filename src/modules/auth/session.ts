import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";

const IS_PROD = process.env.NODE_ENV === "production";
/** `__Host-` prefix requires Secure + Path=/ + no Domain: prevents subdomain cookie injection. */
export const SESSION_COOKIE = IS_PROD ? "__Host-katdict_session" : "katdict_session";

const idleMinutes = () => Number(process.env.SESSION_IDLE_MINUTES ?? 60);
const absoluteHours = () => Number(process.env.SESSION_ABSOLUTE_HOURS ?? 12);

export interface CreatedSession {
  token: string;
  expiresAt: Date;
  id: string;
}

export async function createSession(
  userId: string,
  opts: { mfaVerified: boolean; ip?: string | null; userAgent?: string | null },
): Promise<CreatedSession> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + absoluteHours() * 3600_000);
  const s = await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt,
      mfaVerified: opts.mfaVerified,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
    },
  });
  return { token, expiresAt, id: s.id };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

/** Validates a session token; returns the live session or null. Updates last-seen (throttled). */
export async function validateSessionToken(token: string) {
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) } });
  if (!session || session.revokedAt) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return null;
  if (session.lastSeenAt.getTime() + idleMinutes() * 60_000 <= now) {
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return null;
  }
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return session;
}

export async function revokeSession(sessionId: string) {
  await prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllUserSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}
