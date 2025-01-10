import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  LanguageModelV1ToolCallPart,
  LanguageModelV1Message,
  LanguageModelV1TextPart,
  LanguageModelV1ImagePart,
  LanguageModelV1Prompt,
  LanguageModelV1ToolChoice,
} from "@ai-sdk/provider";
import { ClientOptions } from "openai";
import { zodToJsonSchema } from "zod-to-json-schema";
import { LogLine } from "../../types/log";
import { AvailableModel } from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
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
      // Handle system message separately
      const systemMessage = optionsInitial.messages.find(
        (msg) => msg.role === "system",
      );
      const userMessages = optionsInitial.messages.filter(
        (msg) => msg.role !== "system",
      );

      // Format messages according to LanguageModelV1 types
      const formattedMessages: LanguageModelV1Prompt = userMessages.map(
        (msg): LanguageModelV1Message => {
          if (msg.role === "system") {
            return {
              role: "system",
              content:
                typeof msg.content === "string"
                  ? msg.content
                  : msg.content
                      .map((c) => ("text" in c ? c.text : ""))
                      .join(""),
            };
          } else if (msg.role === "user") {
            return {
              role: "user",
              content:
                typeof msg.content === "string"
                  ? [
                      {
                        type: "text",
                        text: msg.content,
                      } as LanguageModelV1TextPart,
                    ]
                  : msg.content.map((content) => {
                      if ("image_url" in content) {
                        const imagePart: LanguageModelV1ImagePart = {
                          type: "image",
                          image: new URL(content.image_url.url),
                        };
                        return imagePart;
                      }
                      const textPart: LanguageModelV1TextPart = {
                        type: "text",
                        text: content.text,
                      };
                      return textPart;
                    }),
            };
          } else {
            return {
              role: "assistant",
              content:
                typeof msg.content === "string"
                  ? [
                      {
                        type: "text",
                        text: msg.content,
                      } as LanguageModelV1TextPart,
                    ]
                  : msg.content.map((content) => {
                      if ("text" in content) {
                        const textPart: LanguageModelV1TextPart = {
                          type: "text",
                          text: content.text,
                        };
                        return textPart;
                      }
                      if (
                        "toolCallId" in content &&
                        "toolName" in content &&
                        "args" in content
                      ) {
                        const toolCallPart: LanguageModelV1ToolCallPart = {
                          type: "tool-call",
                          toolCallId: content.toolCallId as string,
                          toolName: content.toolName as string,
                          args: content.args,
                        };
                        return toolCallPart;
                      }
                      return {
                        type: "text",
                        text: "",
                      } as LanguageModelV1TextPart;
                    }),
            };
          }
        },
      );

      // Add image if present
      if (optionsInitial.image) {
        const imageMessage: LanguageModelV1Message = {
          role: "user",
          content: [
            {
              type: "image",
              image: new URL(
                `data:image/jpeg;base64,${optionsInitial.image.buffer.toString("base64")}`,
              ),
            } as LanguageModelV1ImagePart,
            ...(optionsInitial.image.description
              ? [
                  {
                    type: "text",
                    text: optionsInitial.image.description,
                  } as LanguageModelV1TextPart,
                ]
              : []),
          ],
        };
        formattedMessages.push(imageMessage);
      }

      // Handle tools and response model
      let tools = optionsInitial.tools?.map((tool) => ({
        type: "function" as const,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));

      // Add response model as a tool if present
      if (optionsInitial.response_model) {
        const jsonSchema = zodToJsonSchema(
          optionsInitial.response_model.schema,
        );
        const extractTool = {
          type: "function" as const,
          name: "print_extracted_data",
          description: `Extract data according to the schema: ${optionsInitial.response_model.name}`,
          parameters: jsonSchema,
        };
        tools = tools ? [...tools, extractTool] : [extractTool];
      }

      const toolChoice: LanguageModelV1ToolChoice =
        optionsInitial.response_model
          ? { type: "tool", toolName: "print_extracted_data" }
          : { type: "auto" };

      const model = this.provider(this.modelName);
      const response = await model.doGenerate({
        inputFormat: "messages",
        mode: {
          type: "regular",
          tools,
          toolChoice,
        },
        prompt: [
          ...(systemMessage
            ? [
                {
                  role: "system" as const,
                  content:
                    typeof systemMessage.content === "string"
                      ? systemMessage.content
                      : systemMessage.content
                          .map((c) => ("text" in c ? c.text : ""))
                          .join(""),
                },
              ]
            : []),
          ...formattedMessages,
        ],
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

      // Handle tool calls if present
      if (llmResponse.choices[0].message.tool_calls?.length) {
        const toolCall = llmResponse.choices[0].message.tool_calls[0];
        if (toolCall.function.name === "extract_data") {
          try {
            const parsedData = JSON.parse(toolCall.function.arguments);

            if (this.enableCaching) {
              this.cache.set(
                cacheOptions,
                parsedData,
                optionsInitial.requestId,
              );
            }

            return parsedData as T;
          } catch (error) {
            logger({
              category: "openrouter",
              message: "parse error",
              level: 0,
              auxiliary: {
                error: {
                  value: error instanceof Error ? error.message : String(error),
                  type: "string",
                },
                toolCall: {
                  value: JSON.stringify(toolCall),
                  type: "object",
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
