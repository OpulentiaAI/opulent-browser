import type { YouSearchItem } from './deepsearch';
import { evaluatorDebug } from './lib/debug-logger';

export interface EvaluationResult {
  completeness: number; // 0..1
  gaps: string[];
  optimized_query: string;
  additional_queries?: string[];
  reasoning?: string;
}

export async function evaluateYouResults(
  query: string,
  items: YouSearchItem[],
  opts: { provider: 'google' | 'gateway' | 'nim' | 'openrouter'; apiKey: string; model?: string; braintrustApiKey?: string }
): Promise<EvaluationResult> {
  const evaluatorTimer = evaluatorDebug.time('Evaluate Results');
  
  evaluatorDebug.info('Starting evaluation', {
    query,
    queryLength: query.length,
    itemCount: items.length,
    provider: opts.provider,
    model: opts.model,
  });
  const { z } = await import('zod');
  const { getWrappedAI } = await import('./lib/ai-wrapped');
  const aiModule = await getWrappedAI(opts.braintrustApiKey);
  const { generateObject } = aiModule;

  // Pick fast default model for latency
  let model: any;
  if (opts.provider === 'gateway') {
    const { createGateway } = await import('@ai-sdk/gateway');
    const client = createGateway({ apiKey: opts.apiKey });
    model = client(opts.model || 'google:gemini-2.5-flash');
  } else if (opts.provider === 'nim') {
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
    const client = createOpenAICompatible({
      name: 'nim',
      baseURL: 'https://integrate.api.nvidia.com/v1',
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
      },
    });
    model = client.chatModel(opts.model || 'deepseek-ai/deepseek-r1');
  } else if (opts.provider === 'openrouter') {
    const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
    const client = createOpenRouter({
      apiKey: opts.apiKey,
      headers: {
        'HTTP-Referer': 'https://opulentia.ai',
        'X-Title': 'Opulent Browser',
      },
    });
    model = client.chat(opts.model || 'minimax/minimax-m2');
  } else {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    const client = createGoogleGenerativeAI({ apiKey: opts.apiKey });
    model = client(opts.model || 'gemini-2.5-flash');
  }

  const top = items.slice(0, 8).map((i, idx) => ({
    idx: idx + 1,
    title: (i.title || '').slice(0, 120),
    desc: (i.description || '').slice(0, 220),
    url: i.url,
    age: i.page_age || ''
  }));

  const schema = z.object({
    completeness: z.number().min(0).max(1),
    gaps: z.array(z.string()).max(5).default([]),
    optimized_query: z.string().min(3),
    additional_queries: z.array(z.string()).max(3).optional(),
    reasoning: z.string().max(280).optional(),
  });

  // GEPA-optimized system prompt: enhanced through AI-powered evolutionary optimization
  // Run ID: intermediate-1761861270442
  const sys = `You are a search analyst. Evaluate web results for completeness. If the completeness score is below 0.8, identify specific information gaps and provide brief reasoning based on result quality. Craft one new, actionable search query designed to fill these gaps. Return structured JSON only, adhering to the required schema.`;

  const user = [
    `Original query: ${query}`,
    '',
    'Top results:',
    ...top.map(t => `- [${t.idx}] ${t.title} — ${t.desc} (${t.url})`),
    '',
    'Assess completeness (0..1), list key gaps (<=5), produce a single optimized_query and up to 3 additional_queries.',
  ].join('\n');

  evaluatorDebug.debug('Calling generateObject for evaluation', {
    modelType: typeof model,
    schemaFields: Object.keys(schema.shape),
    promptLength: user.length,
    systemPromptLength: sys.length,
  });
  
  const result = await generateObject({
    model,
    schema,
    system: sys,
    prompt: user,
  });
  
  evaluatorTimer();
  evaluatorDebug.info('Evaluation completed', {
    completeness: result.object.completeness,
    gapCount: result.object.gaps.length,
    hasOptimizedQuery: !!result.object.optimized_query,
    additionalQueryCount: result.object.additional_queries?.length || 0,
    hasReasoning: !!result.object.reasoning,
  });

  return result.object as EvaluationResult;
}
