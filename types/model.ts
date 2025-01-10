import type { ClientOptions as AnthropicClientOptions } from "@anthropic-ai/sdk";
import type { ClientOptions as OpenAIClientOptions } from "openai";
import { z } from "zod";

export const AvailableModelSchema = z.enum([
  // OpenAI models
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4o-2024-08-06",
  "o1-mini",
  "o1-preview",
  // Anthropic models
  "claude-3-5-sonnet-latest",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-20240620",
  // OpenRouter models
  "anthropic/claude-3.5-sonnet",
  "anthropic/claude-3.5-sonnet:beta",
]);

export type AvailableModel = z.infer<typeof AvailableModelSchema>;

export type ModelProvider = "openai" | "anthropic" | "openrouter";

export type ClientOptions = OpenAIClientOptions | AnthropicClientOptions;

export interface AnthropicJsonSchemaObject {
  definitions?: {
    MySchema?: { properties?: Record<string, unknown>; required?: string[] };
  };
  properties?: Record<string, unknown>;
  required?: string[];
}
