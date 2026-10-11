import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { UnauthenticatedError } from "@/lib/errors";
import { loadActor, type Actor } from "@/modules/rbac/actor";
import { assertCan } from "@/modules/rbac/authorize";
import type { Permission } from "@/modules/rbac/permissions";
import { readSessionToken, validateSessionToken } from "./session";
import { getSetting } from "@/modules/settings/service";

/** Resolves the current actor once per request (React cache). */
export const getActor = cache(async (): Promise<Actor | null> => {
  const token = await readSessionToken();
  if (!token) return null;
  const session = await validateSessionToken(token);
  if (!session) return null;
  return loadActor(prisma, session.userId, { id: session.id, mfaVerified: session.mfaVerified });
});

export type MfaGate = "ok" | "challenge" | "enroll";

/** Determines whether an actor must complete or enrol MFA before using the app. */
export async function mfaGate(actor: Actor): Promise<MfaGate> {
  if (actor.mfaEnabled) return actor.mfaVerified ? "ok" : "challenge";
  if (!actor.privileged) return "ok";
  const required = await getSetting("security.requireMfaForPrivileged");
  return required ? "enroll" : "ok";
}

/** For server actions / route handlers: throws if not signed in or MFA incomplete. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new UnauthenticatedError();
  if ((await mfaGate(actor)) !== "ok") throw new UnauthenticatedError("Multi-factor authentication is required.");
  return actor;
}

/** For pages: redirects to login / MFA instead of throwing. */
export async function requirePageActor(permission?: Permission): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  const gate = await mfaGate(actor);
  if (gate === "challenge") redirect("/mfa");
  if (gate === "enroll") redirect("/account/security?enroll=1");
  if (permission) {
    try {
      assertCan(actor, permission);
    } catch {
      redirect("/dashboard?denied=1");
    }
  }
  return actor;
}
