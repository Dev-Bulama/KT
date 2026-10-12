"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { chatbotAllowedOn, type ChatbotScope } from "@/lib/site-paths";
import type { ChatbotScript } from "@/modules/site/chatbot-snippet";

declare global {
  interface Window {
    __katdictChatbotLoaded?: boolean;
  }
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null;

function loadScript(s: ChatbotScript): Promise<void> {
  return new Promise((resolve) => {
    const el = document.createElement("script");
    for (const [k, v] of Object.entries(s.attrs)) el.setAttribute(k, v);
    el.dataset.katdictChatbot = "true";
    if (s.src) {
      el.async = false;
      el.src = s.src;
      const done = () => resolve();
      el.addEventListener("load", done, { once: true });
      el.addEventListener("error", done, { once: true });
      setTimeout(done, 15_000);
    } else {
      el.text = s.code ?? "";
    }
    document.body.appendChild(el);
    if (!s.src) resolve();
  });
}

/**
 * Injects the administrator-approved chatbot scripts, in order, on allowed
 * pages only. Third-party code cannot be "unloaded", so when the user moves
 * from a widget page to a page where the widget is not allowed (sign-in,
 * account, admin…), the browser does a full page load to drop it.
 */
export function ChatbotLoader({ scripts, scope }: { scripts: ChatbotScript[]; scope: ChatbotScope }) {
  const pathname = usePathname();
  const allowed = chatbotAllowedOn(pathname, scope);

  useEffect(() => {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
    if (!allowed) {
      if (window.__katdictChatbotLoaded) window.location.reload();
      return;
    }
    if (!window.__katdictChatbotLoaded) {
      window.__katdictChatbotLoaded = true;
      (async () => {
        for (const s of scripts) await loadScript(s);
      })();
    }
    return () => {
      // Leaving this layout (e.g. to /login). If no other loader takes over, reload to drop the widget.
      if (window.__katdictChatbotLoaded) reloadTimer = setTimeout(() => window.location.reload(), 50);
    };
  }, [allowed, scripts]);

  return null;
}
