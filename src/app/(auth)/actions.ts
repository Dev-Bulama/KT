"use server";

import { redirect } from "next/navigation";
import { runAction, str, type ActionState } from "@/lib/action";
import { getRequestContext } from "@/lib/request-context";
import { safeRedirectPath } from "@/lib/utils";
import { AppError, RateLimitError } from "@/lib/errors";
import { getActor } from "@/modules/auth/current";
import { clearSessionCookie, setSessionCookie } from "@/modules/auth/session";
import { completeMfa, login, logout, requestPasswordReset, resendVerification, resetPassword } from "@/modules/auth/service";
import { acceptInvitation, registerMda } from "@/modules/mdas/service";

export async function loginAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getRequestContext();
  let target: string | null = null;
  const res = await runAction(async () => {
    const r = await login(str(fd, "email") ?? "", str(fd, "password") ?? "", { ip: ctx.ip, userAgent: ctx.userAgent });
    if (!r.ok) throw new AppError(r.error);
    await setSessionCookie(r.token, r.expiresAt);
    const next = safeRedirectPath(str(fd, "next"));
    target = r.mfaRequired ? `/mfa?next=${encodeURIComponent(next)}` : next;
  });
  if (res.ok && target) redirect(target);
  return res;
}

export async function mfaAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getRequestContext();
  let target: string | null = null;
  const res = await runAction(async () => {
    const actor = await getActor();
    if (!actor?.sessionId) throw new AppError("Your session has expired. Sign in again.");
    const s = await completeMfa(actor.sessionId, str(fd, "code") ?? "", { ip: ctx.ip, userAgent: ctx.userAgent });
    await setSessionCookie(s.token, s.expiresAt);
    target = safeRedirectPath(str(fd, "next"));
  });
  if (res.ok && target) redirect(target);
  return res;
}

export async function logoutAction() {
  const actor = await getActor();
  await logout(actor, actor?.sessionId ?? null);
  await clearSessionCookie();
  redirect("/login?signedOut=1");
}

export async function registerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getRequestContext();
  return runAction(async () => {
    if (str(fd, "password") !== str(fd, "confirmPassword")) throw new AppError("Passwords do not match.");
    const claim = str(fd, "claimMdaId");
    const r = await registerMda(
      {
        representative: { name: str(fd, "repName"), email: str(fd, "repEmail"), phone: str(fd, "repPhone"), designation: str(fd, "repDesignation"), password: str(fd, "password") },
        claimMdaId: claim || undefined,
        profile: {
          name: str(fd, "name"), abbreviation: str(fd, "abbreviation"), category: str(fd, "category"), address: str(fd, "address"),
          officialEmail: str(fd, "officialEmail"), officialPhone: str(fd, "officialPhone"), contactPersonName: str(fd, "contactPersonName"),
          contactPersonDesignation: str(fd, "contactPersonDesignation"), ictContactName: str(fd, "ictContactName"), ictContactEmail: str(fd, "ictContactEmail"),
          ictContactPhone: str(fd, "ictContactPhone"), website: str(fd, "website"), description: str(fd, "description"),
        },
      },
      { ip: ctx.ip },
    );
    return r.message;
  });
}

export async function forgotPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getRequestContext();
  return runAction(async () => {
    try {
      await requestPasswordReset(str(fd, "email") ?? "", { ip: ctx.ip });
    } catch (e) {
      if (!(e instanceof RateLimitError)) throw e;
    }
    return "If an active account exists for that address, a reset link has been sent. Check your inbox.";
  });
}

export async function resetPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    if (str(fd, "password") !== str(fd, "confirmPassword")) throw new AppError("Passwords do not match.");
    await resetPassword(str(fd, "token") ?? "", str(fd, "password") ?? "");
  });
  if (res.ok) redirect("/login?reset=1");
  return res;
}

export async function resendVerificationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await getRequestContext();
  return runAction(async () => {
    await resendVerification(str(fd, "email") ?? "", { ip: ctx.ip });
    return "If the account is awaiting verification, a new link has been sent.";
  });
}

export async function acceptInviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction(async () => {
    if (str(fd, "password") !== str(fd, "confirmPassword")) throw new AppError("Passwords do not match.");
    await acceptInvitation(str(fd, "token") ?? "", { name: str(fd, "name") ?? "", password: str(fd, "password") ?? "", phone: str(fd, "phone"), designation: str(fd, "designation") });
  });
  if (res.ok) redirect("/login?invited=1");
  return res;
}
