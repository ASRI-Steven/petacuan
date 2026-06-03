import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

export async function GET() {
  try {
    const { text } = await generateText({
      model: anthropic('claude-haiku-4-5'),
      prompt: 'Sebutkan 3 alasan kenapa UMKM Indonesia butuh teknologi AI. Singkat, dalam 3 bullet poin.',
    });

    return NextResponse.json({
      success: true,
      response: text,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}