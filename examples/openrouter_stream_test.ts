import { LLMProvider } from "../lib/llm/LLMProvider";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY environment variable is required");
}

async function main() {
  const llmProvider = new LLMProvider(console.log, false);
  const client = llmProvider.getClient("anthropic/claude-3.5-sonnet");

  // Test streaming
  console.log("Testing streaming completion...");
  const result = await client.createChatCompletion({
    options: {
      messages: [
        {
          role: "user",
          content:
            "Write a short story about a robot learning to paint. Stream the response word by word.",
        },
      ],
      stream: true,
      requestId: "test-stream-1",
    },
    logger: console.log,
    onStream: (chunk) => {
      if (chunk.type === "text" && chunk.content) {
        process.stdout.write(chunk.content);
      }
    },
  });

  console.log("\n\nFull response:", JSON.stringify(result, null, 2));

  // Test streaming with tool calls
  console.log("\nTesting streaming with tool calls...");
  const resultWithTools = await client.createChatCompletion({
    options: {
      messages: [
        {
          role: "user",
          content: "Extract the following data: name=Robot, hobby=painting",
        },
      ],
      stream: true,
      requestId: "test-stream-2",
      response_model: {
        name: "ExtractedData",
        schema: z.object({
          name: z.string(),
          hobby: z.string(),
        }),
      },
    },
    logger: console.log,
    onStream: (chunk) => {
      if (chunk.type === "tool_call") {
        console.log("\nTool call:", JSON.stringify(chunk.toolCall, null, 2));
      }
    },
  });

  console.log("\nExtracted data:", JSON.stringify(resultWithTools, null, 2));
}

main().catch(console.error);
