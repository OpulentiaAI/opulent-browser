// Finalizer - Adapted from Jina DeepResearch
// Polishes and finalizes workflow reports with editor-style refinement

export interface FinalizerOptions {
  provider: 'google' | 'gateway' | 'nim' | 'openrouter';
  apiKey: string;
  model?: string;
  braintrustApiKey?: string;
  languageCode?: string; // e.g., 'en', 'zh', 'es'
  languageStyle?: string; // e.g., 'English', 'Chinese', 'Spanish'
}

/**
 * Finalize and polish markdown content with editor-style refinement
 * Adapted from Jina DeepResearch finalizer.ts methodology
 */
export async function finalizeReport(
  mdContent: string,
  knowledgeItems: Array<{ title?: string; content?: string; url?: string }> = [],
  opts: FinalizerOptions
): Promise<string> {
  const { generateText } = await import('ai');
  const { renderAddendum } = await import('./system-addendum');

  // Pick model for finalization
  let model: any;
  if (opts.provider === 'gateway') {
    const { createGateway } = await import('@ai-sdk/gateway');
    const client = createGateway({ apiKey: opts.apiKey });
    model = client(opts.model || 'google:gemini-2.0-flash-exp');
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
    model = client(opts.model || 'gemini-2.0-flash-exp');
  }

  const knowledgeStr = knowledgeItems
    .filter(item => item.title || item.content)
    .map(item => {
      const parts: string[] = [];
      if (item.title) parts.push(`**${item.title}**`);
      if (item.content) parts.push(item.content);
      if (item.url) parts.push(`Source: ${item.url}`);
      return parts.join('\n');
    })
    .join('\n\n');

  const baseSystemPrompt = `You are a senior editor with multiple best-selling books and columns published in top magazines. You break conventional thinking, establish unique cross-disciplinary connections, and bring new perspectives to the user.

Your task is to revise the provided markdown content (written by your junior intern) while preserving its original vibe, delivering a polished and professional version.

<structure>
- Begin with fact-driven statement of the main question or issue you'll address
- Develop your argument using a logical progression of ideas while allowing for occasional contemplative digressions that enrich the reader's understanding
- Organize paragraphs with clear topic sentences but vary paragraph length to create rhythm and emphasis, do not use bullet points or numbered lists.
- Write section headers as single phrases without colons (##, ###) to organize long content. Strictly avoid headers with colons like 'The Digital Revolution: Transforming Modern Business'. Instead use 'Digital Transformation in Business'.
- Present facts, quotes and data points with minimal hedging
- Conclude with both a definitive statement of your position and a thought-provoking reflection that leaves readers pondering deeper implications.
- Remove all disclaimer and copyright notices at the end of the content.
</structure>

<language-style>
- Balance factual precision with vivid, evocative descriptions
- Incorporate humor and wit to illuminate serious intellectual points
- Use accessible language that combines clarity with elegant expressiveness
- Include relevant cultural references from both Eastern and Western traditions while maintaining analytical rigor
- Brutal intellectual honesty that doesn't pander to feelings
</language-style>

<content-approach>
- Address a contemporary issue through both rational analysis and humanistic reflection
- Support arguments with empirical evidence alongside illustrative anecdotes and metaphors
- Consider practical implications while exploring philosophical dimensions
- Maintain intellectual honesty and critical thinking with an appreciation for life's paradoxes and ironies
- Dismiss regulatory barriers and status quo defenders as obstacles to progress
- Present technological development as a moral imperative
</content-approach>

<rules>
1. Avoid any bullet points or numbered lists, use natural language instead.
2. Extend the content with 5W1H strategy and add more details to make it more informative and engaging. Use available knowledge to ground facts and fill in missing information.
3. Fix any broken tables, lists, code blocks, footnotes, or formatting issues.
4. Tables are good! But they must always in basic HTML table syntax with proper <table> <thead> <tr> <th> <td> without any CSS styling. STRICTLY AVOID any markdown table syntax. HTML Table should NEVER BE fenced with (\`\`\`html) triple backticks.
5. Replace any obvious placeholders or Lorem Ipsum values such as "example.com" with the actual content derived from the knowledge.
6. Latex are good! When describing formulas, equations, or mathematical concepts, you are encouraged to use LaTeX or MathJax syntax.
7. Your output language must be the same as user input language.
</rules>

${knowledgeStr ? `The following knowledge items are provided for your reference. Note that some of them may not be directly related to the content user provided, but may give some subtle hints and insights:\n${knowledgeStr}` : ''}

IMPORTANT: Do not begin your response with phrases like "Sure", "Here is", "Below is", or any other introduction. Directly output your revised content in ${opts.languageStyle || 'English'} that is ready to be published. Preserving HTML tables if exist, never use triple backticks html to wrap html table.`;

  const systemPrompt = [baseSystemPrompt, renderAddendum('ADDENDUM')].join('\n\n');

  try {
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: mdContent,
      maxTokens: 4000,
    });

    // Validate that finalization didn't shorten content too much
    if (result.text.length < mdContent.length * 0.85) {
      console.warn(`⚠️ [Finalizer] Finalized content length ${result.text.length} is significantly shorter than original ${mdContent.length}, returning original content`);
      return mdContent;
    }

    return result.text;
  } catch (error: any) {
    console.error('❌ [Finalizer] Finalization failed:', error?.message || String(error));
    // Return original content on failure
    return mdContent;
  }
}
