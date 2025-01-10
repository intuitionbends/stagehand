import { LLMProvider } from "../lib/llm/LLMProvider";
import dotenv from "dotenv";

dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY environment variable is required");
}

async function main() {
  const llmProvider = new LLMProvider(console.log, false);
  const client = llmProvider.getClient("anthropic/claude-3.5-sonnet");

  // Test basic completion
  console.log("Testing basic completion...");
  const result = await client.createChatCompletion({
    options: {
      messages: [
        {
          role: "user",
          content: "What is 2+2? Please answer with just the number.",
        },
      ],
      requestId: "test-1",
    },
    logger: console.log,
  });
  const answer = result.choices[0].message.content;
  console.log("Answer:", answer);
  console.log("\nFull response:", JSON.stringify(result, null, 2));
  console.log(
    "\nNote: OpenRouter automatically routes requests to the most suitable provider.",
  );

  // Test with a different prompt
  console.log("\nTesting with a different prompt...");
  const resultWithSystem = await client.createChatCompletion({
    options: {
      messages: [
        {
          role: "system",
          content:
            "You are a helpful math tutor. Keep answers brief and to the point.",
        },
        {
          role: "user",
          content: "What is the square root of 16?",
        },
      ],
      requestId: "test-2",
    },
    logger: console.log,
  });
  const systemAnswer = resultWithSystem.choices[0].message.content;
  console.log("Answer:", systemAnswer);
  console.log("\nFull response:", JSON.stringify(resultWithSystem, null, 2));
}

main().catch(console.error);
