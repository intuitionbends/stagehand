import { LogLine } from "../../types/log";
import {
  AvailableModel,
  ClientOptions,
  ModelProvider,
} from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
import { AnthropicClient } from "./AnthropicClient";
import { LLMClient } from "./LLMClient";
import { OpenAIClient } from "./OpenAIClient";
import { OpenRouterClient } from "./OpenRouterClient";

export class LLMProvider {
  private openAIModels = new Set([
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4o-2024-08-06",
    "o1-mini",
    "o1-preview",
  ]);

  private anthropicModels = new Set([
    "claude-3-5-sonnet-latest",
    "claude-3-5-sonnet-20240620",
    "claude-3-5-sonnet-20241022",
  ]);

  private getProvider(modelName: AvailableModel): ModelProvider {
    if (this.openAIModels.has(modelName)) {
      return "openai";
    }
    if (this.anthropicModels.has(modelName)) {
      return "anthropic";
    }
    // Any model with a slash is considered an OpenRouter model
    if (modelName.includes("/")) {
      return "openrouter";
    }
    throw new Error(`Unsupported model: ${modelName}`);
  }

  private logger: (message: LogLine) => void;
  private enableCaching: boolean;
  private cache: LLMCache | undefined;

  constructor(logger: (message: LogLine) => void, enableCaching: boolean) {
    this.logger = logger;
    this.enableCaching = enableCaching;
    this.cache = enableCaching ? new LLMCache(logger) : undefined;
  }

  cleanRequestCache(requestId: string): void {
    if (!this.enableCaching) {
      return;
    }

    this.logger({
      category: "llm_cache",
      message: "cleaning up cache",
      level: 1,
      auxiliary: {
        requestId: {
          value: requestId,
          type: "string",
        },
      },
    });
    this.cache.deleteCacheForRequestId(requestId);
  }

  getClient(
    modelName: AvailableModel,
    clientOptions?: ClientOptions,
  ): LLMClient {
    const provider = this.getProvider(modelName);

    switch (provider) {
      case "openai":
        return new OpenAIClient({
          logger: this.logger,
          enableCaching: this.enableCaching,
          cache: this.cache,
          modelName,
          clientOptions,
        });
      case "anthropic":
        return new AnthropicClient({
          logger: this.logger,
          enableCaching: this.enableCaching,
          cache: this.cache,
          modelName,
          clientOptions,
        });
      case "openrouter":
        return new OpenRouterClient({
          logger: this.logger,
          enableCaching: this.enableCaching,
          cache: this.cache,
          modelName,
          clientOptions,
        });
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  }
}
