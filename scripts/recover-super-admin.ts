/**
 * EMERGENCY RECOVERY of a Super Administrator account.
 * Run only under the documented procedure (docs/SECURITY.md §Emergency recovery):
 * two authorised officers present, change ticket raised, direct production DB access.
 *
 *   RECOVERY_CONFIRM=I-UNDERSTAND RECOVERY_TICKET=CHG-123 \
 *     npm run admin:recover -- --email admin@example.gov.ng --witness "Name of second officer"
 *
 * Effect: sets a one-time random password (printed once), clears MFA, unlocks
 * and reactivates the account, revokes all sessions, and writes an audit event.
 * The officer must change the password and re-enrol MFA immediately.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/modules/auth/password";
import { audit } from "../src/modules/audit/audit";

async function main() {
  const args = process.argv.slice(2);
  const email = args[args.indexOf("--email") + 1]?.toLowerCase();
  const witness = args[args.indexOf("--witness") + 1];
  if (process.env.RECOVERY_CONFIRM !== "I-UNDERSTAND" || !process.env.RECOVERY_TICKET) throw new Error("Set RECOVERY_CONFIRM=I-UNDERSTAND and RECOVERY_TICKET=<change ticket>.");
  if (!email || !witness || args.indexOf("--email") < 0 || args.indexOf("--witness") < 0) throw new Error("--email and --witness are required.");
  const user = await prisma.user.findUnique({ where: { email }, include: { roles: { include: { role: true } } } });
  if (!user || !user.roles.some((r) => r.role.key === "SUPER_ADMIN")) throw new Error("No Super Administrator with that email.");
  const temp = `${randomBytes(9).toString("base64url")}Aa1`;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(temp), mfaEnabled: false, mfaSecretEnc: null, mfaRecoveryHashes: [], failedLoginCount: 0, lockedUntil: null, status: "ACTIVE", passwordChangedAt: new Date() } });
    await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, { actorId: null, actorEmail: "SYSTEM:emergency-recovery", action: "auth.emergency_recovery", entityType: "User", entityId: user.id, reason: `Ticket ${process.env.RECOVERY_TICKET}; witness: ${witness}` });
  });
  console.log(`Recovered ${email}. One-time password (shown once): ${temp}`);
  console.log("Sign in now, change the password, and enrol MFA.");
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
