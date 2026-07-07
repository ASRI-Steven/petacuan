// Tipe bersama untuk lapisan AI provider-agnostic.
// Dipakai oleh lib/ai-claude.ts, lib/ai-hf.ts, dan lib/ai.ts (switcher).

export type AiProvider = 'claude' | 'huggingface';

// Definisi tool dalam format netral (JSON Schema).
// Setiap provider mengonversi ke format nativnya masing-masing.
export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ChatResult {
  text: string;
  toolCalls: ChatToolCall[];
}

export interface ChatOptions {
  system: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  maxTokens?: number;
  temperature?: number;
}

// Kontrak yang wajib dipenuhi tiap implementasi provider.
export interface AiProviderImpl {
  MODEL: string;
  generateText(prompt: string): Promise<string>;
  generateJson<T = unknown>(prompt: string): Promise<T>;
  chatWithTools(opts: ChatOptions): Promise<ChatResult>;
}
