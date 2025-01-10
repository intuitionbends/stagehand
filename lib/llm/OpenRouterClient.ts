import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { LanguageModelV1ToolCallPart } from "@ai-sdk/provider";
import { ClientOptions } from "openai";
import { LogLine } from "../../types/log";
import { AvailableModel } from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
import { validateZodSchema } from "../utils";
import {
  CreateChatCompletionOptions,
  LLMClient,
  LLMResponse,
} from "./LLMClient";

export class OpenRouterClient extends LLMClient {
  public type = "openrouter" as const;
  private provider: ReturnType<typeof createOpenRouter>;
  private cache: LLMCache | undefined;
  private enableCaching: boolean;

  constructor({
    enableCaching = false,
    cache,
    modelName,
    clientOptions,
  }: {
    logger: (message: LogLine) => void;
    enableCaching?: boolean;
    cache?: LLMCache;
    modelName: AvailableModel;
    clientOptions?: ClientOptions & {
      extraBody?: Record<string, unknown>;
      compatibility?: "strict" | "compatible";
    };
  }) {
    super(modelName);
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY environment variable is required");
    }

    this.provider = createOpenRouter({
      apiKey,
      compatibility: "strict",
      ...clientOptions,
    });

    this.cache = cache;
    this.enableCaching = enableCaching;
    this.modelName = modelName;
  }

  async createChatCompletion<T = LLMResponse>({
    options: optionsInitial,
    logger,
    retries = 3,
  }: CreateChatCompletionOptions): Promise<T> {
    const { image, requestId, ...optionsWithoutImageAndRequestId } =
      optionsInitial;

    logger({
      category: "openrouter",
      message: "creating chat completion",
      level: 1,
      auxiliary: {
        options: {
          value: JSON.stringify({
            ...optionsWithoutImageAndRequestId,
            requestId,
          }),
          type: "object",
        },
        modelName: {
          value: this.modelName,
          type: "string",
        },
      },
    });

    const cacheOptions = {
      model: this.modelName,
      messages: optionsInitial.messages,
      temperature: optionsInitial.temperature,
      top_p: optionsInitial.top_p,
      frequency_penalty: optionsInitial.frequency_penalty,
      presence_penalty: optionsInitial.presence_penalty,
      image: image,
      response_model: optionsInitial.response_model,
    };

    if (this.enableCaching) {
      const cachedResponse = await this.cache.get<T>(
        cacheOptions,
        optionsInitial.requestId,
      );
      if (cachedResponse) {
        logger({
          category: "llm_cache",
          message: "LLM cache hit - returning cached response",
          level: 1,
          auxiliary: {
            requestId: {
              value: optionsInitial.requestId,
              type: "string",
            },
            cachedResponse: {
              value: JSON.stringify(cachedResponse),
              type: "object",
            },
          },
        });
        return cachedResponse;
      } else {
        logger({
          category: "llm_cache",
          message: "LLM cache miss - no cached response found",
          level: 1,
          auxiliary: {
            requestId: {
              value: optionsInitial.requestId,
              type: "string",
            },
          },
        });
      }
    }

    try {
      const model = this.provider(this.modelName);
      const response = await model.doGenerate({
        inputFormat: "messages",
        mode: {
          type: "regular",
          tools: optionsInitial.tools?.map((tool) => ({
            type: "function" as const,
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
        prompt: optionsInitial.messages.map((msg) => {
          if (msg.role === "system") {
            return {
              role: "system",
              content: Array.isArray(msg.content)
                ? msg.content.map((c) => ("text" in c ? c.text : "")).join("")
                : msg.content,
            };
          } else if (msg.role === "user") {
            return {
              role: "user",
              content: Array.isArray(msg.content)
                ? msg.content.map((c) => {
                    if ("image_url" in c) {
                      return {
                        type: "image",
                        image: new URL(c.image_url.url),
                      };
                    }
                    return {
                      type: "text",
                      text: c.text,
                    };
                  })
                : [{ type: "text", text: msg.content }],
            };
          } else {
            return {
              role: "assistant",
              content: Array.isArray(msg.content)
                ? msg.content.map((c) => {
                    const part = c as {
                      type: string;
                      toolCallId?: string;
                      toolName?: string;
                      args?: unknown;
                      text?: string;
                    };
                    if ("text" in part) {
                      return {
                        type: "text",
                        text: part.text || "",
                      };
                    }
                    if (part.toolCallId && part.toolName && part.args) {
                      return {
                        type: "tool-call",
                        toolCallId: part.toolCallId,
                        toolName: part.toolName,
                        args: part.args,
                      } as LanguageModelV1ToolCallPart;
                    }
                    return {
                      type: "text",
                      text: "",
                    };
                  })
                : [{ type: "text", text: msg.content }],
            };
          }
        }),
        temperature: optionsInitial.temperature,
        topP: optionsInitial.top_p,
        frequencyPenalty: optionsInitial.frequency_penalty,
        presencePenalty: optionsInitial.presence_penalty,
      });

      const llmResponse: LLMResponse = {
        id: "openrouter-" + Date.now(),
        object: "chat.completion",
        created: Date.now(),
        model: this.modelName,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: response.text || null,
              tool_calls: response.toolCalls?.map((tc) => ({
                id: tc.toolCallId,
                type: "function",
                function: {
                  name: tc.toolName,
                  arguments: tc.args,
                },
              })),
            },
            finish_reason: response.finishReason,
          },
        ],
        usage: {
          prompt_tokens: response.usage.promptTokens,
          completion_tokens: response.usage.completionTokens,
          total_tokens:
            response.usage.promptTokens + response.usage.completionTokens,
        },
      };

      logger({
        category: "openrouter",
        message: "response",
        level: 1,
        auxiliary: {
          response: {
            value: JSON.stringify(llmResponse),
            type: "object",
          },
          requestId: {
            value: requestId,
            type: "string",
          },
        },
      });

      if (optionsInitial.response_model) {
        try {
          const content = llmResponse.choices[0].message.content;
          if (!content) {
            throw new Error("No content in response");
          }
          const parsedData = JSON.parse(content);

          if (
            !validateZodSchema(optionsInitial.response_model.schema, parsedData)
          ) {
            if (retries > 0) {
              return this.createChatCompletion({
                options: optionsInitial,
                logger,
                retries: retries - 1,
              });
            }
            throw new Error("Invalid response schema");
          }

          if (this.enableCaching) {
            this.cache.set(cacheOptions, parsedData, optionsInitial.requestId);
          }

          return parsedData as T;
        } catch {
          if (retries > 0) {
            return this.createChatCompletion({
              options: optionsInitial,
              logger,
              retries: retries - 1,
            });
          }
          throw new Error("Failed to parse response as JSON");
        }
      }

      if (this.enableCaching) {
        this.cache.set(cacheOptions, llmResponse, optionsInitial.requestId);
      }

      return llmResponse as T;
    } catch (error) {
      logger({
        category: "openrouter",
        message: "error",
        level: 0,
        auxiliary: {
          error: {
            value: error.message,
            type: "string",
          },
        },
      });

      if (retries > 0) {
        return this.createChatCompletion({
          options: optionsInitial,
          logger,
          retries: retries - 1,
        });
      }

      throw error;
    }
  }
}
