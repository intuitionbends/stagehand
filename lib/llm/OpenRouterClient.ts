import OpenAI, { ClientOptions } from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionUserMessageParam,
} from "openai/resources/chat";
import { LogLine } from "../../types/log";
import { AvailableModel } from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
import { validateZodSchema } from "../utils";
import {
  ChatMessage,
  CreateChatCompletionOptions,
  LLMClient,
  LLMResponse,
} from "./LLMClient";

export class OpenRouterClient extends LLMClient {
  public type = "openrouter" as const;
  private client: OpenAI;
  private cache: LLMCache | undefined;
  private enableCaching: boolean;
  public clientOptions: ClientOptions;

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
    clientOptions?: ClientOptions;
  }) {
    super(modelName);
    this.clientOptions = clientOptions;
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY environment variable is required");
    }
    this.client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey,
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

    if (optionsInitial.image) {
      const screenshotMessage: ChatMessage = {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${optionsInitial.image.buffer.toString("base64")}`,
            },
          },
          ...(optionsInitial.image.description
            ? [{ type: "text", text: optionsInitial.image.description }]
            : []),
        ],
      };

      optionsInitial.messages.push(screenshotMessage);
    }

    let responseFormat = undefined;
    if (optionsInitial.response_model) {
      responseFormat = zodResponseFormat(
        optionsInitial.response_model.schema,
        optionsInitial.response_model.name,
      );
    }

    /* eslint-disable */
    // Remove unsupported options
    const { response_model, ...openRouterOptions } = {
      ...optionsWithoutImageAndRequestId,
      model: this.modelName,
    };
    /* eslint-enable */

    logger({
      category: "openrouter",
      message: "creating chat completion",
      level: 1,
      auxiliary: {
        openRouterOptions: {
          value: JSON.stringify(openRouterOptions),
          type: "object",
        },
      },
    });

    const formattedMessages: ChatCompletionMessageParam[] =
      optionsInitial.messages.map((message) => {
        if (Array.isArray(message.content)) {
          const contentParts = message.content.map((content) => {
            if ("image_url" in content) {
              const imageContent: ChatCompletionContentPartImage = {
                image_url: {
                  url: content.image_url.url,
                },
                type: "image_url",
              };
              return imageContent;
            } else {
              const textContent: ChatCompletionContentPartText = {
                text: content.text,
                type: "text",
              };
              return textContent;
            }
          });

          if (message.role === "system") {
            const formattedMessage: ChatCompletionSystemMessageParam = {
              ...message,
              role: "system",
              content: contentParts.filter(
                (content): content is ChatCompletionContentPartText =>
                  content.type === "text",
              ),
            };
            return formattedMessage;
          } else if (message.role === "user") {
            const formattedMessage: ChatCompletionUserMessageParam = {
              ...message,
              role: "user",
              content: contentParts,
            };
            return formattedMessage;
          } else {
            const formattedMessage: ChatCompletionAssistantMessageParam = {
              ...message,
              role: "assistant",
              content: contentParts.filter(
                (content): content is ChatCompletionContentPartText =>
                  content.type === "text",
              ),
            };
            return formattedMessage;
          }
        }

        return {
          role: message.role,
          content: message.content,
        };
      });

    const body: ChatCompletionCreateParamsNonStreaming = {
      ...openRouterOptions,
      model: this.modelName,
      messages: formattedMessages,
      response_format: responseFormat,
      stream: false,
      tools: optionsInitial.tools?.map((tool) => ({
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
        type: "function",
      })),
    };

    const response = await this.client.chat.completions.create(body);

    logger({
      category: "openrouter",
      message: "response",
      level: 1,
      auxiliary: {
        response: {
          value: JSON.stringify(response),
          type: "object",
        },
        requestId: {
          value: requestId,
          type: "string",
        },
      },
    });

    if (optionsInitial.response_model) {
      const extractedData = response.choices[0].message.content;
      const parsedData = JSON.parse(extractedData);

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
        this.cache.set(
          cacheOptions,
          {
            ...parsedData,
          },
          optionsInitial.requestId,
        );
      }

      return parsedData;
    }

    if (this.enableCaching) {
      logger({
        category: "llm_cache",
        message: "caching response",
        level: 1,
        auxiliary: {
          requestId: {
            value: optionsInitial.requestId,
            type: "string",
          },
          cacheOptions: {
            value: JSON.stringify(cacheOptions),
            type: "object",
          },
          response: {
            value: JSON.stringify(response),
            type: "object",
          },
        },
      });
      this.cache.set(cacheOptions, response, optionsInitial.requestId);
    }

    return response as T;
  }
}
