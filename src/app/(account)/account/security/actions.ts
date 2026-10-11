"use server";

import { revalidatePath } from "next/cache";
import { runAction, str, type ActionState } from "@/lib/action";
import { getRequestContext } from "@/lib/request-context";
import { AppError } from "@/lib/errors";
import { getActor } from "@/modules/auth/current";
import { setSessionCookie } from "@/modules/auth/session";
import { beginMfaEnrollment, changePassword, confirmMfaEnrollment, disableMfa, revokeOwnSession } from "@/modules/auth/service";
import { mfaQrDataUrl } from "@/modules/auth/mfa";

// These actions use getActor() (not requireActor) so that privileged users who
// must enrol MFA can reach them before MFA is complete.
async function actor() {
  const a = await getActor();
  if (!a) throw new AppError("Please sign in.");
  return a;
}

export async function changePasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(async () => {
    if (str(fd, "next") !== str(fd, "confirm")) throw new AppError("New passwords do not match.");
    await changePassword(await actor(), str(fd, "current") ?? "", str(fd, "next") ?? "");
    return "Password changed. Other sessions were signed out.";
  });
}

export async function startMfaAction(): Promise<ActionState> {
  return runAction(async () => {
    const a = await actor();
    if (a.mfaEnabled) throw new AppError("MFA is already enabled.");
    const secret = await beginMfaEnrollment(a);
    return { message: "Scan the QR code with an authenticator app, then enter the 6-digit code.", data: { qr: await mfaQrDataUrl(a.email, secret), secret } };
  });
}

export async function confirmMfaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getRequestContext();
  const res = await runAction(async () => {
    const r = await confirmMfaEnrollment(await actor(), str(fd, "code") ?? "", { ip: ctx.ip, userAgent: ctx.userAgent });
    await setSessionCookie(r.session.token, r.session.expiresAt);
    return { message: "MFA enabled. Store these one-time recovery codes securely — they will not be shown again.", data: { recoveryCodes: r.recoveryCodes } };
  });
  revalidatePath("/account/security");
  return res;
}

export async function disableMfaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction(async () => { await disableMfa(await actor(), str(fd, "password") ?? ""); return "MFA disabled."; });
  revalidatePath("/account/security");
  return res;
}

export async function revokeSessionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction(async () => { await revokeOwnSession(await actor(), str(fd, "sessionId")!); return "Session revoked."; });
  revalidatePath("/account/security");
  return res;
}
