// Implementasi provider: Anthropic Claude.
// Membutuhkan env: ANTHROPIC_API_KEY
import Anthropic from '@anthropic-ai/sdk';
import type { AiProviderImpl, ChatOptions, ChatResult } from './ai-types';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 25000,
      maxRetries: 2,
    });
  }
  return _client;
}

export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

// Helper untuk text generation
export async function generateText(prompt: string): Promise<string> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 220,
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text in response');
  }

  return textBlock.text;
}

// Helper untuk JSON output
export async function generateJson<T = unknown>(prompt: string): Promise<T> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 380,
    messages: [
      {
        role: 'user',
        content: prompt + '\n\nRespond ONLY with valid JSON, no preamble or markdown code blocks.',
      },
    ],
  });

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text in response');
  }

  let text = textBlock.text.trim();
  text = text.replace(/^```(?:json)?\n?/g, '').replace(/\n?```$/g, '');

  return JSON.parse(text) as T;
}

// Chat dengan tool-calling (function calling).
export async function chatWithTools(opts: ChatOptions): Promise<ChatResult> {
  const tools: Anthropic.Tool[] = opts.tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema,
  }));

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 600,
    temperature: opts.temperature ?? 0.2,
    system: opts.system,
    tools,
    messages: opts.messages.map(m => ({ role: m.role, content: m.content })),
  });

  let text = '';
  const toolCalls: ChatResult['toolCalls'] = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        name: block.name,
        input: block.input as Record<string, unknown>,
      });
    }
  }

  return { text: text.trim(), toolCalls };
}

const impl: AiProviderImpl = { MODEL, generateText, generateJson, chatWithTools };
export default impl;
