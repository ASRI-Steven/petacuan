import Anthropic from '@anthropic-ai/sdk';

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY is not set in .env.local');
}

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Pilih model:
// - claude-haiku-4-5 = cepat & murah ($1/1M token input)
// - claude-sonnet-4-6 = balanced ($3/1M)
// - claude-opus-4-7 = paling smart ($15/1M)
// Untuk hackathon: haiku cukup, sonnet kalau mau quality

export const MODEL = 'claude-haiku-4-5';

// Helper untuk text generation
export async function generateText(prompt: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  });
  
  // Extract text dari response
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text in response');
  }
  
  return textBlock.text;
}

// Helper untuk JSON output (structured)
export async function generateJson<T = any>(prompt: string): Promise<T> {
  const response = await anthropic.messages.create({
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
  
  // Strip markdown code blocks if present
  let text = textBlock.text.trim();
  text = text.replace(/^```(?:json)?\n?/g, '').replace(/\n?```$/g, '');
  
  return JSON.parse(text) as T;
}