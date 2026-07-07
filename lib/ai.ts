// Switcher provider AI. Pilih implementasi lewat env AI_PROVIDER.
//   AI_PROVIDER=claude        -> Anthropic Claude (default)
//   AI_PROVIDER=huggingface   -> Hugging Face Inference Providers
//
// Semua konsumen (route API) cukup import dari '@/lib/ai' dan tidak perlu
// tahu provider mana yang aktif. Untuk pindah provider, ubah env saja.
import type { AiProvider, AiProviderImpl } from './ai-types';
import claude from './ai-claude';
import huggingface from './ai-hf';

export type {
  AiProvider,
  ToolDef,
  ChatMessage,
  ChatToolCall,
  ChatResult,
  ChatOptions,
} from './ai-types';

export const AI_PROVIDER: AiProvider =
  process.env.AI_PROVIDER === 'huggingface' ? 'huggingface' : 'claude';

const impl: AiProviderImpl = AI_PROVIDER === 'huggingface' ? huggingface : claude;

export const MODEL = impl.MODEL;

export function generateText(prompt: string): Promise<string> {
  return impl.generateText(prompt);
}

export function generateJson<T = unknown>(prompt: string): Promise<T> {
  return impl.generateJson<T>(prompt);
}

export const chatWithTools = impl.chatWithTools;
