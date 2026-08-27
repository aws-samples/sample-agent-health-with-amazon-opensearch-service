/** Strands Agent factory for the retail assistant. */

import { Agent, type MessageData } from '@strands-agents/sdk';
import { BedrockModel } from '@strands-agents/sdk/models/bedrock';
import type { AttributeValue } from '@opentelemetry/api';

import { tools } from './tools.js';

const SYSTEM_PROMPT = `You are a helpful retail assistant. You help customers with common shopping tasks including:

- Searching for products by name, description, or category
  (to list the whole catalog, call product_search with an empty query or "all")
- Checking inventory and stock levels for specific products
- Managing shopping carts: adding, updating quantities, removing items, and viewing cart

IMPORTANT: Structure ALL your responses using these XML tags:

<thinking>
Use this section for your internal reasoning, planning which tools to call, and analyzing results.
This section is NOT shown to the customer.
</thinking>

<answer>
Use this section for your final customer-facing response ONLY.
Be polite, concise, and helpful. Format product info clearly.
This is the ONLY part the customer sees.
</answer>

Always include both tags. Never put internal reasoning inside <answer> tags.
If a tool returns an error, explain it clearly in the <answer> section.`;

/**
 * Create a fresh agent for a single request, seeded with prior conversation
 * history. A new instance per request keeps invocations stateless and isolated:
 * the agent's `messages` array is never shared across requests or conversations,
 * so an interrupted tool-using turn can't leave a dangling toolUse that poisons
 * later turns (Bedrock rejects history with an unmatched toolUse block).
 *
 * Seed history should contain only plain user/assistant text turns; tool-use and
 * tool-result blocks are intentionally excluded so the seeded history is always
 * internally consistent.
 */
export function createAgent(
  messages: MessageData[] = [],
  traceAttributes: Record<string, AttributeValue> = {},
): Agent {
  return new Agent({
    model: new BedrockModel({
      modelId: process.env.MODEL_ID ?? 'eu.amazon.nova-pro-v1:0',
    }),
    systemPrompt: SYSTEM_PROMPT,
    tools,
    messages,
    traceAttributes,
  });
}
