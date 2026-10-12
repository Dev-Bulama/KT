"use server";

import { revalidatePath } from "next/cache";
import { bool, runAction, str, type ActionState } from "@/lib/action";
import { ValidationError } from "@/lib/errors";
import { requireActor } from "@/modules/auth/current";
import { saveEmailConfig, sendTestEmail } from "@/modules/notifications/email-config";
import { saveChatbotConfig } from "@/modules/site/chatbot";
import { contentFromForm, removeLogo, resetSiteContent, saveSiteContent, uploadLogo } from "@/modules/site/content";
import { isSectionKey } from "@/modules/site/content-schema";

export async function emailConfigAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => {
    await saveEmailConfig(await requireActor(), {
      mode: str(fd, "mode"), host: str(fd, "host"), port: str(fd, "port") || undefined, security: str(fd, "security"),
      username: str(fd, "username"), password: str(fd, "password"), clearPassword: bool(fd, "clearPassword"),
      fromName: str(fd, "fromName"), fromEmail: str(fd, "fromEmail"), replyTo: str(fd, "replyTo"),
    });
    return "Email settings saved. Use “Send test email” to confirm they work.";
  });
  revalidatePath("/admin/email");
  return res;
}

export async function testEmailAction(_: ActionState, fd: FormData) {
  return runAction(async () => {
    const to = str(fd, "to") ?? "";
    const r = await sendTestEmail(await requireActor(), to);
    return r.provider === "console"
      ? "The console provider is active: the message was written to the server log, not sent. Configure SMTP to deliver real email."
      : `Test email sent to ${to} via ${r.provider}. Check the inbox (and spam folder).`;
  });
}

export async function chatbotAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => {
    await saveChatbotConfig(await requireActor(), {
      enabled: bool(fd, "enabled"), provider: str(fd, "provider"), snippet: str(fd, "snippet"), scope: str(fd, "scope"), extraOrigins: str(fd, "extraOrigins"),
    });
    return bool(fd, "enabled") ? "Chatbot widget saved and enabled. Open the home page to check it (allow up to a minute)." : "Chatbot widget settings saved (disabled).";
  });
  revalidatePath("/admin/chatbot");
  revalidatePath("/", "layout");
  return res;
}

function sectionFrom(fd: FormData) {
  const key = str(fd, "section") ?? "";
  if (!isSectionKey(key)) throw new ValidationError("Unknown content section.");
  return key;
}

export async function siteContentAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => {
    const key = sectionFrom(fd);
    await saveSiteContent(await requireActor(), key, contentFromForm(key, fd));
    return "Published. The change is live on the website.";
  });
  revalidatePath("/", "layout");
  return res;
}

export async function resetSiteContentAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => {
    await resetSiteContent(await requireActor(), sectionFrom(fd));
    return "Restored the default content.";
  });
  revalidatePath("/", "layout");
  return res;
}

export async function logoUploadAction(_: ActionState, fd: FormData) {
  const res = await runAction(async () => {
    const file = fd.get("logo");
    await uploadLogo(await requireActor(), file instanceof File ? file : null);
    return "Logo uploaded.";
  });
  revalidatePath("/", "layout");
  return res;
}

export async function logoRemoveAction(): Promise<ActionState> {
  const res = await runAction(async () => {
    await removeLogo(await requireActor());
    return "Logo removed; the built-in mark is shown again.";
  });
  revalidatePath("/", "layout");
  return res;
}
