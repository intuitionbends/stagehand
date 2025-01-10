import { ZodType } from "zod";
import { LLMTool } from "../../types/llm";
import { AvailableModel, ClientOptions } from "../../types/model";
import { LogLine } from "../../types/log";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
}

export type ChatMessageContent =
  | string
  | (ChatMessageImageContent | ChatMessageTextContent)[];

export interface ChatMessageImageContent {
  type: "image_url";
  image_url: { url: string };
  text?: string;
}

export interface ChatMessageTextContent {
  type: string;
  text: string;
}

export const modelsWithVision: AvailableModel[] = [
  "gpt-4o",
  "gpt-4o-mini",
  "claude-3-5-sonnet-latest",
  "claude-3-5-sonnet-20240620",
  "claude-3-5-sonnet-20241022",
  "gpt-4o-2024-08-06",
];

export const AnnotatedScreenshotText =
  "This is a screenshot of the current page state with the elements annotated on it. Each element id is annotated with a number to the top left of it. Duplicate annotations at the same location are under each other vertically.";

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  image?: {
    buffer: Buffer;
    description?: string;
  };
  response_model?: {
    name: string;
    schema: ZodType;
  };
  tools?: LLMTool[];
  tool_choice?: "auto" | "none" | "required";
  maxTokens?: number;
  requestId: string;
  stream?: boolean;
}

export type LLMResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls: {
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }[];
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type LLMStreamResponse = {
  type: "text" | "tool_call" | "tool_call_delta" | "error" | "done";
  content?: string;
  toolCall?: {
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  };
  toolCallDelta?: {
    id: string;
    type: string;
    function: {
      name: string;
      argumentsDelta: string;
    };
  };
  error?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export interface CreateChatCompletionOptions {
  options: ChatCompletionOptions;
  logger: (message: LogLine) => void;
  retries?: number;
  onStream?: (response: LLMStreamResponse) => void | Promise<void>;
}

export abstract class LLMClient {
  public type: "openai" | "anthropic" | "openrouter" | string;
  public modelName: AvailableModel;
  public hasVision: boolean;
  public clientOptions: ClientOptions;
  public userProvidedInstructions?: string;

  constructor(modelName: AvailableModel, userProvidedInstructions?: string) {
    this.modelName = modelName;
    this.hasVision = modelsWithVision.includes(modelName);
    this.userProvidedInstructions = userProvidedInstructions;
  }

  abstract createChatCompletion<T = LLMResponse>(
    options: CreateChatCompletionOptions,
  ): Promise<T>;

  protected async handleStream(
    stream: AsyncIterable<LLMStreamResponse>,
    onStream?: (response: LLMStreamResponse) => void | Promise<void>,
  ): Promise<LLMResponse> {
    let content = "";
    const toolCalls: {
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }[] = [];
    let currentToolCall: {
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    } | null = null;
    let usage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };

    for await (const chunk of stream) {
      if (onStream) {
        await onStream(chunk);
      }

      switch (chunk.type) {
        case "text":
          if (chunk.content) {
            content += chunk.content;
          }
          break;
        case "tool_call":
          if (chunk.toolCall) {
            toolCalls.push(chunk.toolCall);
          }
          break;
        case "tool_call_delta":
          if (chunk.toolCallDelta) {
            if (
              !currentToolCall ||
              currentToolCall.id !== chunk.toolCallDelta.id
            ) {
              currentToolCall = {
                id: chunk.toolCallDelta.id,
                type: chunk.toolCallDelta.type,
                function: {
                  name: chunk.toolCallDelta.function.name,
                  arguments: chunk.toolCallDelta.function.argumentsDelta,
                },
              };
              toolCalls.push(currentToolCall);
            } else {
              currentToolCall.function.arguments +=
                chunk.toolCallDelta.function.argumentsDelta;
            }
          }
          break;
        case "done":
          if (chunk.usage) {
            usage = chunk.usage;
          }
          break;
      }
    }

    return {
      id: `${this.type}-${Date.now()}`,
      object: "chat.completion",
      created: Date.now(),
      model: this.modelName,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: content || null,
            tool_calls: toolCalls,
          },
          finish_reason: "stop",
        },
      ],
      usage,
    };
  }
}
