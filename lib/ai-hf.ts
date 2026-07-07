// Implementasi provider: Hugging Face (Inference Providers, router OpenAI-compatible).
// Membutuhkan env:
//   HF_TOKEN   -> access token Hugging Face (https://huggingface.co/settings/tokens)
//   HF_MODEL   -> (opsional) model id, mis. "meta-llama/Llama-3.3-70B-Instruct"
//
// Catatan: untuk chatWithTools, pilih model yang mendukung tool/function calling
// (mis. Llama-3.3-70B-Instruct, Qwen2.5-72B-Instruct, DeepSeek-V3).
import type { AiProviderImpl, ChatOptions, ChatResult } from './ai-types';

export const MODEL = process.env.HF_MODEL || 'meta-llama/Llama-3.3-70B-Instruct';

const ENDPOINT = 'https://router.huggingface.co/v1/chat/completions';
const TIMEOUT_MS = 25000;

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAiToolCall {
  function: { name: string; arguments: string };
}

interface ChatCompletionBody {
  model: string;
  messages: OpenAiMessage[];
  max_tokens?: number;
  temperature?: number;
  tools?: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
  }>;
  tool_choice?: 'auto' | 'none';
  response_format?: { type: 'json_object' };
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
}

async function chatCompletion(body: ChatCompletionBody): Promise<ChatCompletionResponse> {
  const token = process.env.HF_TOKEN;
  if (!token) {
    throw new Error('HF_TOKEN tidak diset di environment');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Hugging Face error ${res.status}: ${detail}`);
    }

    return (await res.json()) as ChatCompletionResponse;
  } finally {
    clearTimeout(timer);
  }
}

// Helper untuk text generation
export async function generateText(prompt: string): Promise<string> {
  const data = await chatCompletion({
    model: MODEL,
    max_tokens: 220,
    messages: [{ role: 'user', content: prompt }],
  });

  return data.choices[0]?.message?.content?.trim() ?? '';
}

// Helper untuk JSON output
export async function generateJson<T = unknown>(prompt: string): Promise<T> {
  const data = await chatCompletion({
    model: MODEL,
    max_tokens: 380,
    messages: [
      {
        role: 'user',
        content: prompt + '\n\nRespond ONLY with valid JSON, no preamble or markdown code blocks.',
      },
    ],
    response_format: { type: 'json_object' },
  });

  let text = (data.choices[0]?.message?.content ?? '').trim();
  text = text.replace(/^```(?:json)?\n?/g, '').replace(/\n?```$/g, '');

  return JSON.parse(text) as T;
}

// Chat dengan tool-calling (function calling).
export async function chatWithTools(opts: ChatOptions): Promise<ChatResult> {
  const tools = opts.tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const messages: OpenAiMessage[] = [
    { role: 'system', content: opts.system },
    ...opts.messages.map(m => ({ role: m.role, content: m.content })),
  ];

  const data = await chatCompletion({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 600,
    temperature: opts.temperature ?? 0.2,
    messages,
    tools,
    tool_choice: 'auto',
  });

  const msg = data.choices[0]?.message;
  const text = (msg?.content ?? '').trim();
  const toolCalls: ChatResult['toolCalls'] = (msg?.tool_calls ?? []).map(tc => {
    let input: Record<string, unknown> = {};
    try {
      input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      input = {};
    }
    return { name: tc.function.name, input };
  });

  return { text, toolCalls };
}

const impl: AiProviderImpl = { MODEL, generateText, generateJson, chatWithTools };
export default impl;
