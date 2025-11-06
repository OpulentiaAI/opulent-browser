// AI SDK 6 Summarizer - Uses tool/agent calls with You.com Search API
// Replaces You.com Advanced Agent with more reliable AI SDK implementation

import { generateText, streamText, tool, NoSuchToolError, generateObject } from 'ai';
import { z } from 'zod';
import { stepCountIs } from './ai-sdk-6-tools-types';

const LOG_PREFIX = '🤖 [AI-SDK-SUMMARIZER]';

interface AiSdkSummarizerInput {
  objective: string;
  trajectory: string;
  outcome: string;
  model: any; // AI SDK model instance
  youApiKey?: string; // Optional - for You.com search enhancement
  enableStreaming?: boolean; // Enable streaming for real-time UI updates
  updateLastMessage?: (updater: (msg: any) => any) => void; // Callback for streaming updates
}

interface AiSdkSummarizerOutput {
  summary: string;
  duration: number;
  success: boolean;
  searchResults?: any[];
}

/**
 * You.com Search Tool - Direct API calls via AI SDK tool
 */
const youSearchTool = (youApiKey: string) => tool({
  description: 'Search the web using a provider API to find relevant, up-to-date information',
  parameters: z.object({
    query: z.string().describe('Search query'),
    num_results: z.number().optional().default(3).describe('Number of results to return (1-10)'),
  }),
  execute: async ({ query, num_results }) => {
    console.log(`${LOG_PREFIX} 🔍 Web Search: "${query}"`);
    
    try {
      const response = await fetch('https://api.you.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': youApiKey,
        },
        body: JSON.stringify({
          query,
          num_web_results: num_results,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`${LOG_PREFIX} ❌ Web search failed: HTTP ${response.status}`);
        throw new Error(`Web search failed: HTTP ${response.status} - ${errorText}`);
      }
      
      const data = await response.json();
      const results = data.results || [];
      
      console.log(`${LOG_PREFIX} ✅ Found ${results.length} results`);
      
      return {
        success: true,
        results: results.map((r: any) => ({
          title: r.title || '',
          url: r.url || '',
          snippet: r.snippet || r.description || '',
        })),
        count: results.length,
      };
    } catch (error: any) {
      console.error(`${LOG_PREFIX} ❌ Search error:`, error?.message);
      return {
        success: false,
        error: error?.message || String(error),
        results: [],
        count: 0,
      };
    }
  },
});

/**
 * Follow-ups tool for summarizer: renders end-of-run options onto last assistant message
 */
const followUpsTool = (updateLastMessage?: (updater: (msg: any) => any) => void) =>
  tool({
    description: 'Present end-of-run options or inputs to the user. Renders markdown and stores structured metadata.',
    parameters: z.object({
      attachment: z.string().optional(),
      follow_ups_input: z
        .array(
          z.object({
            type: z.enum(['text', 'number', 'date']),
            question: z.string(),
            placeholder: z.union([z.string(), z.number()]).optional(),
            suggestions: z.array(z.string()).optional(),
          })
        )
        .optional(),
      follow_ups_select: z
        .array(
          z.object({
            emoji: z.string().min(1).max(2),
            title: z.string().min(3).max(60),
            prompt: z.string().min(3),
          })
        )
        .optional(),
    }).refine((v) => !v.follow_ups_input || !v.follow_ups_select, {
      message: 'Provide either follow_ups_input or follow_ups_select, not both',
      path: ['follow_ups_input'],
    }),
    execute: async ({ attachment, follow_ups_input, follow_ups_select }) => {
      if (updateLastMessage) {
        updateLastMessage((msg: any) => {
          if (msg.role !== 'assistant') return msg;
          const lines: string[] = [];
          lines.push('', '---', '### Follow-Ups');
          if (attachment) {
            lines.push(`Attachment: ${attachment}`);
          }
          if (Array.isArray(follow_ups_select) && follow_ups_select.length >= 2) {
            lines.push('Please choose one of the options below:');
            for (const opt of follow_ups_select) {
              lines.push(`- ${opt.emoji} **${opt.title}** — ${opt.prompt}`);
            }
          } else if (Array.isArray(follow_ups_input) && follow_ups_input.length >= 2) {
            lines.push('Please provide the following information:');
            for (const q of follow_ups_input) {
              const ph = q.placeholder !== undefined ? ` (placeholder: ${q.placeholder})` : '';
              const sg = q.suggestions && q.suggestions.length ? ` Suggestions: ${q.suggestions.join(', ')}` : '';
              lines.push(`- (${q.type}) ${q.question}${ph}${sg}`);
            }
          } else {
            lines.push('No follow-ups provided.');
          }
          return {
            ...msg,
            content: typeof msg.content === 'string' ? (msg.content + '\n' + lines.join('\n')) : lines.join('\n'),
            metadata: {
              ...msg.metadata,
              hasFollowUps: true,
              followUps: {
                attachment,
                select: follow_ups_select,
                input: follow_ups_input,
              },
              followUpsAt: Date.now(),
            },
          };
        });
      }
      return { success: true };
    },
  });

/**
 * Summarize using AI SDK 6 with tool calls
 * More reliable than You.com Advanced Agent - uses direct API calls
 */
export async function summarizeWithAiSdk(
  input: AiSdkSummarizerInput
): Promise<AiSdkSummarizerOutput> {
  const startTime = Date.now();
  
  console.log(`${LOG_PREFIX} Starting AI SDK summarization...`);
  console.log(`${LOG_PREFIX} Has You.com API: ${!!input.youApiKey}`);
  
  try {
    // Build tools array - include You.com search if API key available
    const tools: Record<string, any> = {};
    const searchResults: any[] = [];
    
    if (input.youApiKey) {
      tools.searchWeb = youSearchTool(input.youApiKey);
    }
    // Always include follow_ups to allow the model to present next actions
    tools.follow_ups = followUpsTool(input.updateLastMessage);
    
    // Build comprehensive prompt (Atlas-style discipline)
    const systemPrompt = `ROLE
You are an expert browser automation analyst. Evaluate execution quality and produce a concise, evidence-based report.

CAPABILITIES
- Read trajectory and outcome text.
- Optionally call searchWeb to enrich with current facts (when You.com key is present).
- Think silently; do not expose chain-of-thought.

EVIDENCE DISCIPLINE
- Cite concrete signals from execution (URLs reached, verified elements, counts) rather than speculation.
- If using search, incorporate only directly relevant facts; avoid overreach.

REPORT FORMAT (markdown)
- ## Summary — 2-3 sentences, crisp and factual
- ## Goal Assessment — achieved/partial/not achieved with 1-2 sentence justification
- ## Key Findings — 3-6 bullets, each grounded in observed evidence
- ## Recommended Next Steps — 3 specific, high-leverage actions

FOLLOW-UPS (optional)
- After producing the report, present 2–4 actionable next-step options using the follow_ups tool (preferred), or skip if none are appropriate.
- Options should be concise and helpful (e.g., "Retry with corrected URL", "Open the most relevant result", "Export detailed report").
- Do not include chain-of-thought.

CONSTRAINTS
- Be concise and actionable. No fluff. No internal reasoning.
- End with exactly one line in uppercase: TASK_COMPLETED: YES or TASK_COMPLETED: NO (required).`;

    // Optionally attach system addendum
    let enrichedSystemPrompt = systemPrompt;
    try {
      const { renderAddendum } = await import('./system-addendum');
      enrichedSystemPrompt = [systemPrompt, renderAddendum('ADDENDUM')].join('\n\n');
    } catch {}

    const userPrompt = `Analyze this browser automation execution:

**Objective:**
${input.objective}

**Execution Trajectory:**
${input.trajectory}

**Final Outcome:**
${input.outcome}

Provide your analysis following the format specified in the system prompt.`;

    console.log(`${LOG_PREFIX} Calling ${input.enableStreaming ? 'streamText' : 'generateText'} with ${Object.keys(tools).length} tools...`);
    
    // Generate summary with tool access
    if (input.enableStreaming && input.updateLastMessage) {
      // Streaming path for real-time UI updates
      console.log(`${LOG_PREFIX} Using streaming mode for real-time updates`);
      
      let streamedText = '';
      const stream = await streamText({
        model: input.model,
        system: enrichedSystemPrompt,
        prompt: userPrompt,
        tools,
        toolChoice: input.youApiKey ? 'required' : 'auto',
        stopWhen: stepCountIs(4),
        prepareStep: async ({ stepNumber }) => {
          if (stepNumber === 0 && input.youApiKey) {
            return { activeTools: ['searchWeb'] } as any;
          }
          return {} as any;
        },
        onStepFinish: async ({ toolResults }) => {
          // Capture search results during streaming to later append as Sources
          if (toolResults && toolResults.length > 0) {
            for (const tr of toolResults) {
              if (tr.toolName === 'searchWeb' && tr.result && Array.isArray((tr.result as any).results)) {
                const results = (tr.result as any).results as Array<{ title?: string; url?: string; snippet?: string }>;
                for (const r of results) {
                  searchResults.push({ title: r.title || '', url: r.url || '', snippet: r.snippet || '' });
                }
              }
            }
          }
        },
        experimental_repairToolCall: async ({ toolCall, tools, inputSchema, error }) => {
          if (NoSuchToolError.isInstance(error)) return null;
          try {
            const { object: repaired } = await generateObject({
              model: input.model as any,
              schema: (inputSchema as any)(toolCall),
              prompt: [
                `The model tried to call the tool "${toolCall.toolName}" with the following inputs:`,
                JSON.stringify(toolCall.input),
                `The tool accepts the following schema:`,
                JSON.stringify((inputSchema as any)(toolCall)),
                'Please fix the inputs to satisfy the schema.',
              ].join('\n'),
            });
            return { ...toolCall, input: JSON.stringify(repaired) } as any;
          } catch {
            return null;
          }
        },
        maxTokens: 600,
        temperature: 0.7,
        maxSteps: 3,
      });
      
      // Stream the response and update UI
      for await (const chunk of stream.textStream) {
        streamedText += chunk;
        
        // Update UI with accumulated text
        if (input.updateLastMessage) {
          input.updateLastMessage((msg: any) => ({
            ...msg,
            content: msg.role === 'assistant' 
              ? `---\n## Summary & Next Steps\n\n${streamedText}`
              : msg.content
          }));
        }
      }
      
      const duration = Date.now() - startTime;

      console.log(`${LOG_PREFIX} ✅ Streaming complete in ${duration}ms`);
      console.log(`${LOG_PREFIX} Text length: ${streamedText.length} chars`);
      // Append sources if any search results were collected
      if (searchResults.length > 0) {
        const sourcesMd = ['\n\n### Sources', ...searchResults.map((r, i) => `- [${r.title || `Source ${i+1}`}](${r.url})`)].join('\n');
        streamedText += sourcesMd;
        if (input.updateLastMessage) {
          input.updateLastMessage((msg: any) => ({
            ...msg,
            content: msg.role === 'assistant' 
              ? `${msg.content || ''}${sourcesMd}`
              : msg.content
          }));
        }
      }

      return {
        summary: streamedText,
        duration,
        success: true,
        searchResults: searchResults.length > 0 ? searchResults : undefined,
      };
    } else {
      // Non-streaming path
    const result = await generateText({
      model: input.model,
      system: enrichedSystemPrompt,
      prompt: userPrompt,
      tools,
      toolChoice: input.youApiKey ? 'required' : 'auto',
      stopWhen: stepCountIs(3),
      maxTokens: 600,
      temperature: 0.7,
      maxSteps: 3, // Allow up to 3 tool calls for research
    });
    
    const duration = Date.now() - startTime;
    
    console.log(`${LOG_PREFIX} ✅ Generation complete in ${duration}ms`);
    console.log(`${LOG_PREFIX} Text length: ${result.text?.length || 0} chars`);
    console.log(`${LOG_PREFIX} Tool calls: ${result.steps?.length || 0}`);
    
    // Extract search results if any
    if (result.steps) {
      for (const step of result.steps) {
        if (step.toolCalls) {
          for (const call of step.toolCalls) {
            if (call.toolName === 'searchWeb' && call.result) {
              searchResults.push(...(call.result.results || []));
            }
          }
        }
      }
    }
    
    return {
      summary: result.text || '',
      duration,
      success: true,
      searchResults: searchResults.length > 0 ? searchResults : undefined,
    };
    }
    
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`${LOG_PREFIX} ❌ AI SDK summarization failed:`, error?.message);
    
    return {
      summary: '',
      duration,
      success: false,
    };
  }
}

/**
 * Fallback: Simple summarization without tools
 */
export async function summarizeWithoutTools(
  input: AiSdkSummarizerInput
): Promise<AiSdkSummarizerOutput> {
  const startTime = Date.now();
  
  console.log(`${LOG_PREFIX} Using simple summarization (no tools)...`);
  
  try {
    const result = await generateText({
      model: input.model,
      system: 'You are a browser automation analyst. Provide concise, actionable summaries.',
      prompt: `Summarize this execution:

**Objective:** ${input.objective}
**Trajectory:** ${input.trajectory}
**Outcome:** ${input.outcome}

Provide: Summary (2-3 sentences), Goal assessment, and 3 next steps.`,
      maxTokens: 400,
      temperature: 0.7,
    });
    
    const duration = Date.now() - startTime;
    
    return {
      summary: result.text || '',
      duration,
      success: true,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    console.error(`${LOG_PREFIX} ❌ Simple summarization failed:`, error?.message);
    
    return {
      summary: '',
      duration,
      success: false,
    };
  }
}
