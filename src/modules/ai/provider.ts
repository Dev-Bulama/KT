import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

/**
 * Provider-agnostic AI interface. Business logic depends only on this
 * interface; providers are selected by AI_PROVIDER. To add a provider,
 * implement AIProvider and register it in getAIProvider().
 */
export interface AIJsonRequest<S extends z.ZodType> {
  system: string;
  prompt: string;
  schema: S;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

export interface AITextRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

export interface AIUsage {
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  generateJson<S extends z.ZodType>(req: AIJsonRequest<S>): Promise<{ data: z.infer<S>; usage: AIUsage }>;
  generateText(req: AITextRequest): Promise<{ text: string; usage: AIUsage }>;
}

export class AIRefusalError extends Error {
  constructor(message = "The AI provider declined this request.") {
    super(message);
    this.name = "AIRefusalError";
  }
}

class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  constructor(apiKey: string, readonly model: string, timeoutMs: number) {
    // maxRetries kept low: callers have deterministic fallbacks.
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  }

  async generateJson<S extends z.ZodType>(req: AIJsonRequest<S>) {
    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: req.maxTokens ?? 8000,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      thinking: { type: "adaptive" },
      output_config: { format: betaZodOutputFormat(req.schema), effort: req.effort ?? "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (res.stop_reason === "refusal") throw new AIRefusalError();
    if (res.stop_reason === "max_tokens") throw new Error("AI response was truncated (max_tokens).");
    if (!res.parsed_output) throw new Error("AI response did not match the expected schema.");
    return { data: res.parsed_output as z.infer<S>, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, model: res.model } };
  }

  async generateText(req: AITextRequest) {
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 8000,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      thinking: { type: "adaptive" },
      output_config: { effort: req.effort ?? "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (res.stop_reason === "refusal") throw new AIRefusalError();
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    if (!text) throw new Error("Empty AI response.");
    return { text, usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, model: res.model } };
  }
}

let cached: AIProvider | null | undefined;

/** Returns the configured provider, or null when external AI is disabled/unconfigured. */
export function getAIProvider(): AIProvider | null {
  if (cached !== undefined) return cached;
  const kind = process.env.AI_PROVIDER ?? "disabled";
  if (kind === "anthropic" && process.env.AI_API_KEY) {
    cached = new AnthropicProvider(process.env.AI_API_KEY, process.env.AI_MODEL || "claude-opus-5-5", Number(process.env.AI_TIMEOUT_MS ?? 45000));
  } else {
    cached = null;
  }
  return cached;
}

/** Tests may inject a fake provider. */
export function setAIProvider(p: AIProvider | null | undefined) {
  cached = p;
}
