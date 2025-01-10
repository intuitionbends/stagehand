import type { ClientOptions as AnthropicClientOptions } from "@anthropic-ai/sdk";
import type { ClientOptions as OpenAIClientOptions } from "openai";
import { z } from "zod";

export const OpenRouterModelSchema = z
  .string()
  .refine((model) => model.includes("/"), {
    message: "OpenRouter model must be in format: provider/model",
  });

export const AvailableModelSchema = z.union([
  // OpenAI models
  z.enum([
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4o-2024-08-06",
    "o1-mini",
    "o1-preview",
  ]),
  // Anthropic models
  z.enum([
    "claude-3-5-sonnet-latest",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-sonnet-20240620",
  ]),
  // OpenRouter models - accepts any provider/model format
  OpenRouterModelSchema,
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
