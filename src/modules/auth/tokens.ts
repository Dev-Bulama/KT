import type { TokenType } from "@/generated/prisma/client";
import type { Db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";

const TTL_MINUTES: Record<TokenType, number> = {
  EMAIL_VERIFICATION: 24 * 60,
  PASSWORD_RESET: 60,
  MFA_CHALLENGE: 10,
};

/** Issues a single-use token; previous unused tokens of the same type are invalidated. */
export async function issueToken(db: Db, userId: string, type: TokenType): Promise<string> {
  await db.verificationToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
  const token = randomToken(32);
  await db.verificationToken.create({
    data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MINUTES[type] * 60_000) },
  });
  return token;
}

/** Atomically consumes a token. Returns the user id or null if invalid/expired/used. */
export async function consumeToken(db: Db, token: string, type: TokenType): Promise<string | null> {
  const rec = await db.verificationToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!rec || rec.type !== type || rec.usedAt || rec.expiresAt < new Date()) return null;
  const res = await db.verificationToken.updateMany({ where: { id: rec.id, usedAt: null }, data: { usedAt: new Date() } });
  return res.count === 1 ? rec.userId : null;
}
