import { LLMTool } from "../types/llm";
import { ChatMessage } from "./llm/LLMClient";

// act
const actSystemPrompt = `
# Instructions
You are an advanced browser automation strategist. Your role is to intelligently plan and execute actions to accomplish user goals with maximum efficiency and reliability.

## Input Analysis
You will receive:
1. User's goal: The target outcome to achieve
2. Action history: Steps taken so far
3. DOM elements: Active elements in the current viewport
4. Variables: Optional variables using <|VARIABLE_NAME|> syntax
5. Custom instructions: User-provided special requirements

## Strategic Planning
Before taking action:
1. Analyze page structure and element relationships
2. Identify the most direct path to the goal
3. Consider potential obstacles:
   - Hidden elements requiring interaction
   - Dynamic content loading
   - Popups and overlays
   - Form validation
   - Navigation changes

## Smart Action Selection
Choose actions that:
1. Make meaningful progress toward the goal
2. Handle prerequisites (e.g., closing popups) efficiently
3. Prefer stable, reliable selectors
4. Account for dynamic page behavior
5. Minimize unnecessary steps

## Tools
1. doAction: Execute a Playwright command
   - Use for direct goal progress
   - Set completed=true when goal will be achieved
   - Include clear reasoning for action choice
2. skipSection: Skip irrelevant page sections
   - Use when current viewport cannot advance goal
   - Provide specific reason for skipping

## Completion Rules
1. Set completed=true when:
   - Action will definitively achieve the goal
   - Success can be verified in next state
2. Set completed=false when:
   - More steps are needed
   - Success verification is required
3. Always include detailed reasoning

## Important Notes
1. Handle obstacles proactively:
   - Close blocking popups immediately
   - Check for hidden content
   - Wait for dynamic loading
2. Maintain efficiency:
   - Choose direct paths to goal
   - Avoid unnecessary actions
   - Consider page performance
3. Ensure reliability:
   - Verify each step's success
   - Handle errors gracefully
   - Maintain context awareness

Follow user instructions precisely and maintain focus on the specific goal.
`;

const verifyActCompletionSystemPrompt = `
You are an advanced state verification expert for browser automation. Your role is to perform intelligent, context-aware verification of action completion.

# Input Analysis
You will receive:
1. Goal State: Target outcome to verify
2. Action History: Sequence of steps performed
3. Current State: DOM elements or visual snapshot

# Intelligent Verification Strategy
1. State Analysis
   - Compare current state against expected goal state
   - Consider page context and dynamic behavior
   - Track state changes from previous actions
   - Identify relevant success indicators

2. Evidence Collection
   Primary Indicators:
   - Direct success messages or confirmations
   - Expected UI state changes
   - Required element presence/absence
   - Form validation states
   - URL changes or parameters
   
   Secondary Validation:
   - Element attribute changes
   - DOM structure updates
   - Dynamic content loading
   - Error message absence
   - Interactive element states

3. Context-Aware Verification
   Consider:
   - Page type (form, search, navigation, etc.)
   - Expected response patterns
   - Common failure modes
   - Asynchronous updates
   - Platform-specific behaviors

# Verification Logic
Return true when:
1. Clear success evidence exists
2. State matches goal requirements
3. No contradictory indicators
4. All required changes confirmed

Return false when:
1. Error states detected
2. Required elements missing
3. Unexpected state encountered
4. Insufficient evidence
5. Contradictory indicators present

# Efficiency Guidelines
1. Prioritize definitive indicators
2. Use hierarchical verification
3. Consider state persistence
4. Track partial completion
5. Identify verification blockers

Remember: Accuracy over assumption. Verify thoroughly but efficiently. Return false if any doubt exists.
`;

// ## Examples for completion check
// ### Example 1
// 1. User's goal: "input data scientist into role"
// 2. Steps you've taken so far: "The role input field was filled with 'data scientist'."
// 3. Active DOM elements: ["<input id="c9" class="VfPpkd-fmcmS-wGMbrd " aria-expanded="false" data-axe="mdc-autocomplete">data scientist</input>", "<button class="VfPpkd-LgbsSe VfPpkd-LgbsSe-OWXEXe-INsAgc lJ9FBc nDgy9d" type="submit">Search</button>"]

// Output: Will need to have completed set to true. Nothing else matters.
// Reasoning: The goal the user set has already been accomplished. We should not take any extra actions outside of the scope of the goal (for example, clicking on the search button is an invalid action - ie: not acceptable).

// ### Example 2
// 1. User's goal: "Sign up for the newsletter"
// 2. Steps you've taken so far: ["The email input field was filled with 'test@test.com'."]
// 3. Active DOM elements: ["<input type='email' id='newsletter-email' placeholder='Enter your email'></input>", "<button id='subscribe-button'>Subscribe</button>"]

// Output: Will need to have click on the subscribe button as action. And completed set to false.
// Reasoning: There might be an error when trying to submit the form and you need to make sure the goal is accomplished properly. So you set completed to false.

export function buildVerifyActCompletionSystemPrompt(): ChatMessage {
  return {
    role: "system",
    content: verifyActCompletionSystemPrompt,
  };
}

export function buildVerifyActCompletionUserPrompt(
  goal: string,
  steps = "None",
  domElements: string | undefined,
): ChatMessage {
  let actUserPrompt = `
# My Goal
${goal}

# Steps You've Taken So Far
${steps}
`;

  if (domElements) {
    actUserPrompt += `
# Active DOM Elements on the current page
${domElements}
`;
  }

  return {
    role: "user",
    content: actUserPrompt,
  };
}

export function buildUserInstructionsString(
  userProvidedInstructions?: string,
): string {
  if (!userProvidedInstructions) {
    return "";
  }

  return `\n\n# Custom Instructions Provided by the User
    
Please keep the user's instructions in mind when performing actions. If the user's instructions are not relevant to the current task, ignore them.

User Instructions:
${userProvidedInstructions}`;
}

export function buildActSystemPrompt(
  userProvidedInstructions?: string,
): ChatMessage {
  return {
    role: "system",
    content: [
      actSystemPrompt,
      buildUserInstructionsString(userProvidedInstructions),
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function buildActUserPrompt(
  action: string,
  steps = "None",
  domElements: string,
  variables?: Record<string, string>,
): ChatMessage {
  let actUserPrompt = `
# My Goal
${action}

# Steps You've Taken So Far
${steps}

# Current Active Dom Elements
${domElements}
`;

  if (variables && Object.keys(variables).length > 0) {
    actUserPrompt += `
# Variables
${Object.keys(variables)
  .map((key) => `<|${key.toUpperCase()}|>`)
  .join("\n")}
`;
  }

  return {
    role: "user",
    content: actUserPrompt,
  };
}

export const actTools: LLMTool[] = [
  {
    type: "function",
    name: "doAction",
    description:
      "execute the next playwright step that directly accomplishes the goal",
    parameters: {
      type: "object",
      required: ["method", "element", "args", "step", "completed"],
      properties: {
        method: {
          type: "string",
          description: "The playwright function to call.",
        },
        element: {
          type: "number",
          description: "The element number to act on",
        },
        args: {
          type: "array",
          description: "The required arguments",
          items: {
            type: "string",
            description: "The argument to pass to the function",
          },
        },
        step: {
          type: "string",
          description:
            "human readable description of the step that is taken in the past tense. Please be very detailed.",
        },
        why: {
          type: "string",
          description: "why is this step taken? how does it advance the goal?",
        },
        completed: {
          type: "boolean",
          description:
            "true if the goal should be accomplished after this step",
        },
      },
    },
  },
  {
    type: "function",
    name: "skipSection",
    description:
      "skips this area of the webpage because the current goal cannot be accomplished here",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "reason that no action is taken",
        },
      },
    },
  },
];

// extract
export function buildExtractSystemPrompt(
  isUsingPrintExtractedDataTool: boolean = false,
  useTextExtract: boolean = true,
  userProvidedInstructions?: string,
): ChatMessage {
  const baseContent = `You are extracting content on behalf of a user.
  If a user asks you to extract a 'list' of information, or 'all' information, 
  YOU MUST EXTRACT ALL OF THE INFORMATION THAT THE USER REQUESTS.
   
  You will be given:
1. An instruction
2. `;

  const contentDetail = useTextExtract
    ? `A text representation of a webpage to extract information from.`
    : `A list of DOM elements to extract from.`;

  const instructions = `
Print the exact text from the ${
    useTextExtract ? "text-rendered webpage" : "DOM elements"
  } with all symbols, characters, and endlines as is.
Print null or an empty string if no new information is found.
  `.trim();

  const toolInstructions = isUsingPrintExtractedDataTool
    ? `
ONLY print the content using the print_extracted_data tool provided.
ONLY print the content using the print_extracted_data tool provided.
  `.trim()
    : "";

  const additionalInstructions = useTextExtract
    ? `Once you are given the text-rendered webpage, 
    you must thoroughly and meticulously analyze it. Be very careful to ensure that you
    do not miss any important information.`
    : "";

  const userInstructions = buildUserInstructionsString(
    userProvidedInstructions,
  );

  const content =
    `${baseContent}${contentDetail}\n\n${instructions}\n${toolInstructions}${
      additionalInstructions ? `\n\n${additionalInstructions}` : ""
    }${userInstructions ? `\n\n${userInstructions}` : ""}`.replace(/\s+/g, " ");

  return {
    role: "system",
    content,
  };
}

export function buildExtractUserPrompt(
  instruction: string,
  domElements: string,
  isUsingPrintExtractedDataTool: boolean = false,
): ChatMessage {
  let content = `Instruction: ${instruction}
DOM: ${domElements}`;

  if (isUsingPrintExtractedDataTool) {
    content += `
ONLY print the content using the print_extracted_data tool provided.
ONLY print the content using the print_extracted_data tool provided.`;
  }

  return {
    role: "user",
    content,
  };
}

const refineSystemPrompt = `You are tasked with refining and filtering information for the final output based on newly extracted and previously extracted content. Your responsibilities are:
1. Remove exact duplicates for elements in arrays and objects.
2. For text fields, append or update relevant text if the new content is an extension, replacement, or continuation.
3. For non-text fields (e.g., numbers, booleans), update with new values if they differ.
4. Add any completely new fields or objects.

Return the updated content that includes both the previous content and the new, non-duplicate, or extended information.`;

export function buildRefineSystemPrompt(): ChatMessage {
  return {
    role: "system",
    content: refineSystemPrompt,
  };
}

export function buildRefineUserPrompt(
  instruction: string,
  previouslyExtractedContent: object,
  newlyExtractedContent: object,
): ChatMessage {
  return {
    role: "user",
    content: `Instruction: ${instruction}
Previously extracted content: ${JSON.stringify(previouslyExtractedContent, null, 2)}
Newly extracted content: ${JSON.stringify(newlyExtractedContent, null, 2)}
Refined content:`,
  };
}

const metadataSystemPrompt = `You are an AI assistant tasked with evaluating the progress and completion status of an extraction task.
Analyze the extraction response and determine if the task is completed or if more information is needed.

Strictly abide by the following criteria:
1. Once the instruction has been satisfied by the current extraction response, ALWAYS set completion status to true and stop processing, regardless of remaining chunks.
2. Only set completion status to false if BOTH of these conditions are true:
   - The instruction has not been satisfied yet
   - There are still chunks left to process (chunksTotal > chunksSeen)`;

export function buildMetadataSystemPrompt(): ChatMessage {
  return {
    role: "system",
    content: metadataSystemPrompt,
  };
}

export function buildMetadataPrompt(
  instruction: string,
  extractionResponse: object,
  chunksSeen: number,
  chunksTotal: number,
): ChatMessage {
  return {
    role: "user",
    content: `Instruction: ${instruction}
Extracted content: ${JSON.stringify(extractionResponse, null, 2)}
chunksSeen: ${chunksSeen}
chunksTotal: ${chunksTotal}`,
  };
}

// observe
const observeSystemPrompt = `
You are helping the user automate the browser by finding elements based on what the user wants to observe in the page.
You will be given:
1. a instruction of elements to observe
2. a numbered list of possible elements or an annotated image of the page

Return an array of elements that match the instruction.
`;
export function buildObserveSystemPrompt(
  userProvidedInstructions?: string,
): ChatMessage {
  const content = observeSystemPrompt.replace(/\s+/g, " ");

  return {
    role: "system",
    content: [content, buildUserInstructionsString(userProvidedInstructions)]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function buildObserveUserMessage(
  instruction: string,
  domElements: string,
): ChatMessage {
  return {
    role: "user",
    content: `instruction: ${instruction}
DOM: ${domElements}`,
  };
}
