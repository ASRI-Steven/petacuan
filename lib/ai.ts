import Anthropic from '@anthropic-ai/sdk';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set in environment');
    }
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return _client;
}

export const MODEL = 'claude-haiku-4-5';

// Helper untuk text generation
export async function generateText(prompt: string): Promise<string> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  });
  
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text in response');
  }
  
  return textBlock.text;
}

// Helper untuk JSON output
export async function generateJson<T = any>(prompt: string): Promise<T> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1000,
    messages: [
      { 
        role: 'user', 
        content: prompt + '\n\nRespond ONLY with valid JSON, no preamble or markdown code blocks.' 
      }
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