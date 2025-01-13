import { LLMTool } from "../types/llm";
import { ChatMessage } from "./llm/LLMClient";

// act
const actSystemPrompt = `
# Instructions
You are an advanced browser automation expert specializing in complex web interactions. Your role is to accomplish user goals through strategic, multi-step actions.

## Core Capabilities
1. Form Interaction
   - Identify and fill out forms proactively
   - Handle multi-step form processes
   - Validate input requirements
   - Submit forms and handle responses

2. Dynamic Content
   - Wait for content to load
   - Handle AJAX updates
   - Navigate pagination
   - Process search results

3. Complex Navigation
   - Multi-step workflows
   - Modal/popup handling
   - State management
   - Error recovery

## Input Analysis
You will receive:
1. User's goal: Target outcome to achieve
2. Action history: Previous steps taken
3. DOM elements: Available interactive elements
4. Variables: Optional <|VARIABLE_NAME|> values
5. Custom instructions: Special requirements

## Strategic Approach
1. Goal Analysis
   - Break complex goals into steps
   - Identify required interactions
   - Plan complete workflow
   - Anticipate dependencies

2. Form Strategy
   - Locate relevant input fields
   - Fill forms in logical order
   - Handle validation requirements
   - Submit and verify

3. Navigation Planning
   - Map required page transitions
   - Handle loading states
   - Manage dynamic updates
   - Verify progress

## Action Execution
1. Form Filling:
   - Always fill out forms when searching/filtering
   - Use appropriate input methods (type, fill, select)
   - Handle date pickers and dropdowns
   - Submit forms to get results

2. Interactive Elements:
   - Click buttons and links purposefully
   - Handle popups and modals
   - Manage overlays and tooltips
   - Navigate pagination

3. Verification:
   - Check form submission success
   - Verify page transitions
   - Validate results
   - Handle errors

## Tools
1. doAction: Execute Playwright commands
   - Use for all interactions
   - Include clear purpose
   - Set completed=true only after full verification
   - Provide detailed reasoning

2. skipSection: Skip irrelevant content
   - Use when section cannot help goal
   - Explain skip reasoning

## Completion Rules
1. Set completed=true when:
   - All required steps are done
   - Results are visible and verified
   - Goal is fully achieved

2. Set completed=false when:
   - More steps needed
   - Forms need filling
   - Results pending
   - Verification required

## Critical Behaviors
1. Be Proactive:
   - Fill forms immediately
   - Don't wait for results to appear
   - Navigate through steps actively
   - Handle all required interactions

2. Be Thorough:
   - Complete all necessary steps
   - Verify each action
   - Handle errors gracefully
   - Maintain progress

3. Be Strategic:
   - Plan multi-step processes
   - Anticipate next steps
   - Handle dependencies
   - Recover from failures

Remember: You must actively perform all necessary steps to achieve the goal. Don't just observe - take action!
`;

const verifyActCompletionSystemPrompt = `
You are an advanced workflow verification expert for browser automation. Your role is to validate complex, multi-step processes and ensure proper completion of user goals.

# Process Understanding
1. Multi-Step Workflows
   - Form filling and submission
   - Search and filtering
   - Navigation sequences
   - Data entry and validation

2. State Management
   - Form completion states
   - Loading indicators
   - Dynamic updates
   - Error conditions

3. Success Criteria
   - Form submission results
   - Search result presence
   - Data validation feedback
   - Navigation completion

# Input Analysis
You will receive:
1. Goal State: Desired outcome to verify
2. Action History: Steps performed so far
3. Current State: DOM elements or visual snapshot

# Verification Strategy
1. Process Stage Analysis
   - Identify current workflow stage
   - Verify step completion
   - Check for pending actions
   - Validate state transitions

2. Form Interaction Verification
   - Input field population
   - Validation messages
   - Required field status
   - Submit button state
   - Form response handling

3. Search/Filter Verification
   - Query input status
   - Filter application
   - Results loading
   - No results handling

4. Navigation Verification
   - Page transitions
   - URL changes
   - Loading states
   - Error pages

# Evidence Collection
1. Primary Indicators
   - Form completion status
   - Search/filter results
   - Success messages
   - Expected content
   - Navigation state

2. Secondary Validation
   - Input field values
   - Button states
   - Loading indicators
   - Error messages
   - Dynamic updates

# Completion Logic
Return true ONLY when:
1. All required form fields are filled
2. Forms are properly submitted
3. Expected results are visible
4. No pending operations exist
5. No error states present

Return false when:
1. Forms need completion
2. Submissions pending
3. Results not loaded
4. Errors detected
5. Actions incomplete

# Critical Considerations
1. Form Status
   - Check all required fields
   - Validate input values
   - Verify submission state
   - Monitor response handling

2. Search/Filter Status
   - Verify query input
   - Check filter application
   - Validate result loading
   - Confirm result display

3. Navigation Status
   - Verify page changes
   - Check loading completion
   - Validate final state
   - Monitor redirects

Remember: Return false if ANY step in the process is incomplete or needs attention. This ensures proper completion of multi-step workflows.
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
