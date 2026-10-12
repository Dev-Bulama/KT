import { getChatbotRuntime } from "@/modules/site/chatbot";
import { ChatbotLoader } from "./chatbot-loader";

/** Renders the configured chatbot widget loader for a layout area. */
export async function ChatbotWidget({ area }: { area: "public" | "app" }) {
  const c = await getChatbotRuntime();
  if (!c.enabled || (area === "app" && c.scope !== "public_and_app")) return null;
  return <ChatbotLoader scripts={c.scripts} scope={c.scope} />;
}
