import { LLMProvider } from "../lib/llm/LLMProvider";
import dotenv from "dotenv";

dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY environment variable is required");
}

async function main() {
  const llmProvider = new LLMProvider(console.log, false);

  // Test with different OpenRouter models
  const models = ["google/gemini-flash-1.5-8b"];

  for (const modelName of models) {
    console.log(`\nTesting with model: ${modelName}`);
    const client = llmProvider.getClient(modelName);

    const result = await client.createChatCompletion({
      options: {
        messages: [
          {
            role: "user",
            content: "What is 2+2? Please answer with just the number.",
          },
        ],
        requestId: `test-${modelName}`,
      },
      logger: console.log,
    });

    console.log(
      `Response from ${modelName}:`,
      result.choices[0].message.content,
    );
  }
}

main().catch(console.error);
