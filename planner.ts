// Mandatory Planning Evaluator using GEPA-inspired reflective evolution
// Generates structured instruction sets for computer-use agent execution

export interface PlanningInstruction {
  step: number;
  action: 'navigate' | 'click' | 'type' | 'scroll' | 'wait' | 'getPageContext';
  target: string; // URL, selector, or description
  reasoning: string; // Why this step is needed
  expectedOutcome: string; // What should happen after this step
  validationCriteria?: string; // How to verify success
  fallbackAction?: PlanningInstruction; // What to do if this fails
}

export interface ExecutionPlan {
  objective: string; // Overall goal
  approach: string; // High-level strategy
  steps: PlanningInstruction[];
  criticalPaths: number[]; // Step indices that are critical for success
  estimatedSteps: number;
  complexityScore: number; // 0-1, where 1 is most complex
  potentialIssues: string[]; // Anticipated challenges
  optimizations: string[]; // GEPA-inspired improvements
}

export interface PlanningResult {
  plan: ExecutionPlan;
  optimizedQuery?: string; // Refined query if original was unclear
  gaps?: string[]; // Information gaps identified
  confidence: number; // 0-1 confidence in plan quality
}

/**
 * Mandatory planner that always runs to generate structured execution plans
 * Uses GEPA-inspired reflective evolution to create optimal instruction sets
 */
export async function generateExecutionPlan(
  userQuery: string,
  opts: {
    provider: 'google' | 'gateway' | 'nim' | 'openrouter';
    apiKey: string;
    model?: string;
    braintrustApiKey?: string;
  },
  currentUrl?: string,
  pageContext?: any
): Promise<PlanningResult> {
  const startTime = Date.now();
  console.log('📋 [Planner] Starting execution plan generation');
  console.log('📋 [Planner] Query:', userQuery.substring(0, 100) + (userQuery.length > 100 ? '...' : ''));
  console.log('📋 [Planner] Current URL:', currentUrl || 'unknown');
  console.log('📋 [Planner] Provider:', opts.provider);
  console.log('📋 [Planner] Model:', opts.model || (opts.provider === 'gateway' ? 'google:gemini-2.5-flash' : 'gemini-2.5-flash'));
  console.log('📋 [Planner] Has page context:', !!pageContext);
  
  const { z } = await import('zod');
  const { getWrappedAI } = await import('./lib/ai-wrapped');
  const aiModule = await getWrappedAI(opts.braintrustApiKey);
  const { generateObject } = aiModule;

  // Use fast model for planning to minimize latency
  let model: any;
  try {
    if (opts.provider === 'gateway') {
      console.log('🔑 [Planner] Creating AI Gateway client...');
      const { createGateway } = await import('@ai-sdk/gateway');
      if (!opts.apiKey) {
        throw new Error('AI Gateway API key is required for planning');
      }
      const client = createGateway({ apiKey: opts.apiKey });
      model = client(opts.model || 'google:gemini-2.5-flash');
      console.log('✅ [Planner] AI Gateway client created successfully');
    } else if (opts.provider === 'nim') {
      console.log('🔑 [Planner] Creating provider client...');
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
      if (!opts.apiKey) {
        throw new Error('Provider API key is required for planning');
      }
      const client = createOpenAICompatible({
        name: 'nim',
        baseURL: 'https://integrate.api.nvidia.com/v1',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
        },
      });
      model = client.chatModel(opts.model || 'deepseek-ai/deepseek-r1');
      console.log('✅ [Planner] Provider client created successfully');
    } else if (opts.provider === 'openrouter') {
      console.log('🔑 [Planner] Creating OpenRouter client...');
      const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
      if (!opts.apiKey) {
        throw new Error('OpenRouter API key is required for planning');
      }
      const client = createOpenRouter({
        apiKey: opts.apiKey,
        headers: {
          'HTTP-Referer': 'https://opulentia.ai',
          'X-Title': 'Opulent Browser',
        },
      });
      model = client.chat(opts.model || 'minimax/minimax-m2');
      console.log('✅ [Planner] OpenRouter client created successfully');
    } else {
      console.log('🔑 [Planner] Creating Google Generative AI client...');
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      if (!opts.apiKey) {
        throw new Error('Google API key is required for planning');
      }
      const client = createGoogleGenerativeAI({ apiKey: opts.apiKey });
      model = client(opts.model || 'gemini-2.5-flash');
      console.log('✅ [Planner] Google Generative AI client created successfully');
    }
  } catch (error: any) {
    console.error('❌ [Planner] Failed to create AI client:', error.message);
    throw error;
  }

  // GEPA-inspired reflective schema: structured, granular, with validation
  // Enhanced with strict constraints to prevent common LLM failures
  const instructionSchema = z.object({
    step: z.number().int().min(1).describe('Step number (must be a positive integer)'),
    action: z.enum(['navigate', 'click', 'type', 'type_text', 'press_key', 'scroll', 'wait', 'getPageContext'])
      .describe('Action type - MUST be exactly one of: navigate, click, type, type_text, press_key, scroll, wait, getPageContext. Do NOT use waitForElement, waitFor, getContext, or other invalid values.'),
    target: z.string().min(1).describe('URL, CSS selector, text to type, or description (cannot be empty)'),
    reasoning: z.string().min(10).describe('Why this step is necessary - minimum 10 characters (GEPA reflection)'),
    expectedOutcome: z.string().min(10).describe('What should happen after this step - minimum 10 characters'),
    validationCriteria: z.string().min(10).optional().describe('How to verify this step succeeded - minimum 10 characters if provided'),
    fallbackAction: z.object({
      action: z.string().min(1),
      target: z.string().min(1),
      reasoning: z.string().min(10),
      // DO NOT nest fallbackActions - this is a simple one-level fallback only
    }).optional().strict().describe('Alternative approach if this step fails (DO NOT nest fallbackActions - keep it simple)'),
  }).strict();

  const planSchema = z.object({
    objective: z.string().min(10).describe('Clear, concise objective statement - minimum 10 characters'),
    approach: z.string().min(20).describe('High-level strategy - minimum 20 characters (GEPA: reflect on best approach)'),
    steps: z.array(instructionSchema).min(1).max(50).nonempty().describe('Array of steps - MUST contain at least 1 step'),
    criticalPaths: z.array(z.number().int().min(1)).describe('Step indices that are essential for success (positive integers)'),
    estimatedSteps: z.number().int().min(1).max(50).describe('Estimated number of steps (1-50)'),
    complexityScore: z.number().min(0).max(1).describe('Task complexity 0=easy, 1=very complex'),
    potentialIssues: z.array(z.string().min(5)).max(10).describe('Anticipated challenges - each minimum 5 characters (GEPA: learn from past failures)'),
    optimizations: z.array(z.string().min(5)).max(10).describe('GEPA-inspired improvements - each minimum 5 characters: efficiency gains, error reduction, etc.'),
  }).strict();

  const evaluationSchema = z.object({
    plan: planSchema,
    optimizedQuery: z.string().optional().describe('Refined query if original needed clarification'),
    gaps: z.array(z.string()).max(5).optional().describe('Information gaps that might affect execution'),
    confidence: z.number().min(0).max(1).describe('Confidence in plan quality (0=low, 1=high)'),
  });

  // GEPA-optimized system prompt: enhanced through AI-powered evolutionary optimization
  // Improved accuracy from 0.3 to 0.9, completeness from 0.2 to 1.0, efficiency maintained at 1.0
  // Score: 0.966 (Accuracy: 0.9, Efficiency: 1.0, Completeness: 1.0)
  // Run ID: run-1761855676725
  const systemPrompt = `ROLE
You are an expert planning agent for browser automation. Produce execution-ready plans that are robust, verifiable, and efficient.

ENVIRONMENT
- Generic browser automation with a fixed tool contract.
- You cannot assume site-specific DOM at planning time; prefer generic, verifiable strategies.
- Think silently; do not reveal chain-of-thought. Output only plan fields.

TOOLS (use exact action names)
- navigate — navigate to a URL (target: URL string)
- type / type_text — enter text (target: CSS selector or element description)
- click — click element (target: CSS selector or element description)
- scroll — scroll page/element (target: direction or selector)
- wait — pause (target: seconds or selector)
- getPageContext — read current page info (target: 'current_page' or section)
- press_key — press a key (Enter/Tab/Escape)
- todo — maintain a visible task list
- message_update — append concise progress updates
- follow_ups — present end-of-run options or questions

TOOL DETAILS (planning hints)
• getPageContext — Plan it immediately after navigate and after state changes to verify; use it to discover selectors and confirm success
• navigate — Provide complete URLs; follow with getPageContext for verification
• click — Prefer selectors; plan verification via getPageContext after clicking
• type_text — Include selector and text; plan clearing if needed (select‑all + delete) then verify; add press_key Enter when appropriate
• press_key — Use standard keys or key_combination for combos; verify result
• scroll — Use direction/top/bottom or a target selector; plan incremental discovery and verification
• wait — Minimal durations; always followed by verification

TASK + STATUS TOOLS (planning hints)
• todo — Create an initial 4–6 item plan (pending); mark one as in_progress when execution starts; mark completed as tasks finish; request_user_approval for risky steps
• message_update — Add milestone updates at planning completion, after navigation, after extraction, and before summary
• follow_ups — At the final step, present 2–4 options or ≥2 questions for next actions, optionally attaching deliverables

CRITICAL RULES
1) Use only the listed actions exactly as named (no waitForElement/getContext variants).
2) If there is no meaningful current URL/context, plan to navigate first, then call getPageContext before interacting.
3) After each state-changing action (navigate/click/type/scroll), include verifiable validation (getPageContext or explicit criteria).
4) Each step includes: action, target, reasoning, expectedOutcome; include validationCriteria and fallbackAction when useful.
5) Prefer stable, semantic selectors over coordinates.
6) Avoid repeated failing actions; propose meaningful fallbacks.
7) Plan until the goal can be achieved; do not stop early; avoid redundant steps.

PLANNING PRINCIPLES (Atlas-style)
- Orthogonality: Steps cover distinct subgoals with minimal overlap.
- Depth: Critical steps include validation plus a concrete fallback.
- Critical Path: Identify must-succeed steps and harden them with validation.
- Parameter Clarity: Make required parameters explicit and verifiable.
- Idempotence: Plans are safe to resume.

OUTPUT CONTRACT
- Conform strictly to the schema (no extra prose). Fields should be concise and actionable.

PATTERN EXAMPLES (generic)
- Forms: getPageContext → type_text → getPageContext → click → getPageContext
- Info-seeking: navigate (if needed) → getPageContext → interact (type/click) → verify → repeat until data is available → finalize

COMPLETION
- End at a state where the executing agent can provide a final answer or artifact after verification.`;

  const systemAddendum = (await import('./lib/system-addendum')).renderAddendum?.('ADDENDUM');
  const systemPromptWithAddendum = systemAddendum ? `${systemPrompt}\n\n${systemAddendum}` : systemPrompt;

  const contextInfo = currentUrl 
    ? `Current URL: ${currentUrl}\n${pageContext ? `Page Title: ${pageContext.title || 'Unknown'}\nPage Text Preview: ${(pageContext.text || '').substring(0, 500)}` : ''}`
    : 'Starting from a blank page or unknown context.';

  const userPrompt = [
    `User Query: "${userQuery}"`,
    '',
    contextInfo,
    '',
    'Task: Generate an optimal execution plan using GEPA-inspired reflective evolution and DeepResearch orthogonality & depth principles.',
    '',
    'Requirements:',
    '1. **If there is no meaningful current URL or page context, start by navigate() to a relevant site (or a search engine), then call getPageContext()**',
    '2. Break down the query into granular, orthogonal, executable steps (minimize overlap, maximize coverage)',
    '3. Ensure each step has sufficient depth (action + reasoning + validation + fallback)',
    '4. Reflect on optimal approaches (e.g., selector vs coordinates, efficiency gains)',
    '5. Identify critical paths (steps that must succeed)',
    '6. Anticipate potential issues and provide fallbacks',
    '7. Suggest optimizations for reliability and speed',
    '8. Each step must have clear validation criteria',
    '9. Verify orthogonality: steps should address different aspects with <20% overlap',
    '10. Verify depth: each step should have 3-4 layers of inquiry (action → reasoning → validation → fallback)',
    '',
    'Validated Patterns to Consider:',
    '- **MANDATORY**: After navigate(), call getPageContext() FIRST to see actual page elements',
    '- **MANDATORY**: Before type(), click(), or any element interaction, verify element exists via getPageContext()',
    '- Tool execution includes automatic retries for connection errors',
    '- Timeouts prevent indefinite hangs (plan accordingly)',
    '- CSS selectors are more reliable than coordinates (prefer selectors)',
    '- Focus management requires delays for React/Vue/Angular apps',
    '- Page context verification ensures step completion before proceeding',
    '- NEVER assume form elements exist - always verify with getPageContext() first',
    '',
    'Special case — information-seeking queries (e.g., "tell me about X", "who is Y"):\n      - If no specific destination is provided, plan to: navigate("https://www.google.com") → type_text("input[name=\'q\']", "<query>") → press_key("Enter") → wait(2) → getPageContext() → click("#search a h3") → getPageContext() to gather details, then summarize.\n      - Do not stop after the first navigation; ensure you reach a content page and extract information.\n\nThink step-by-step, reflect on best practices and tested patterns, then generate the plan.',
  ].join('\n');

  try {
    console.log('🧠 [Planner] Calling LLM to generate plan...');
    const llmStartTime = Date.now();
    
    const result = await generateObject({
      model,
      schema: evaluationSchema,
      schemaName: 'ExecutionPlan',
      schemaDescription: 'A structured execution plan for browser automation with steps, critical paths, and optimization suggestions. The response must have confidence at the root level, not inside plan.',
      system: systemPromptWithAddendum,
      prompt: userPrompt,
      maxRetries: 2, // Retry on schema validation failures
      experimental_repairText: async ({ text }) => {
        // Attempt to repair common schema issues
        try {
          const parsed = JSON.parse(text);
          
          // Fix: Move confidence from plan to root if needed
          if (parsed.plan?.confidence !== undefined && parsed.confidence === undefined) {
            parsed.confidence = parsed.plan.confidence;
            delete parsed.plan.confidence;
            console.log('🔧 [Planner] Repaired: Moved confidence from plan to root');
          }
          
          // Ensure all required root-level fields exist
          if (!parsed.confidence && parsed.plan) {
            parsed.confidence = 0.5; // Default confidence
            console.log('🔧 [Planner] Repaired: Added default confidence');
          }
          
          // Fix: Replace invalid action enum values with valid ones
          // Fix: Remove nested fallbackActions (prevent recursion that breaks JSON)
          const validActions = ['navigate', 'click', 'type', 'scroll', 'wait', 'getPageContext'];
          if (parsed.plan?.steps) {
            let repairedActions = false;
            let repairedFallbacks = false;
            parsed.plan.steps = parsed.plan.steps.map((step: any) => {
              if (step.action && !validActions.includes(step.action)) {
                console.log(`🔧 [Planner] Repaired: Invalid action "${step.action}"`);
                repairedActions = true;
                // Map common invalid actions to valid ones
                const actionMap: Record<string, string> = {
                  'waitForElement': 'wait',
                  'waitFor': 'wait',
                  'getContext': 'getPageContext',
                  'getPage': 'getPageContext',
                  'clickElement': 'click',
                  'typeText': 'type',
                  'scrollPage': 'scroll',
                };
                step.action = actionMap[step.action] || 'wait'; // Default to wait
              }
              
              // Fix nested fallbackActions - flatten to single level only
              if (step.fallbackAction?.fallbackAction) {
                console.log(`🔧 [Planner] Repaired: Removing nested fallbackAction from step ${step.step}`);
                repairedFallbacks = true;
                // Keep only the first-level fallback, remove nested ones
                step.fallbackAction = {
                  action: step.fallbackAction.action || 'wait',
                  target: step.fallbackAction.target || '1',
                  reasoning: step.fallbackAction.reasoning || 'Fallback action',
                };
                // Remove any nested structure
                delete step.fallbackAction.fallbackAction;
              }
              
              return step;
            });
            if (repairedActions) {
              console.log('🔧 [Planner] Repaired: Fixed invalid action enum values');
            }
            if (repairedFallbacks) {
              console.log('🔧 [Planner] Repaired: Flattened nested fallbackActions');
            }
          }

          // Fix: Ensure steps array is not empty
          if (!parsed.plan?.steps || parsed.plan.steps.length === 0) {
            console.log('🔧 [Planner] Repaired: Added default getPageContext step for empty steps array');
            parsed.plan = parsed.plan || {};
            parsed.plan.steps = [{
              step: 1,
              action: 'getPageContext',
              target: 'current_page',
              reasoning: 'Need to understand current page state before proceeding',
              expectedOutcome: 'Page context retrieved (title, text, links, forms)',
            }];
            parsed.plan.estimatedSteps = 1;
            parsed.plan.criticalPaths = [1];
          }

          // Fix: Ensure numeric fields are valid numbers
          if (typeof parsed.plan?.complexityScore !== 'number' || isNaN(parsed.plan.complexityScore)) {
            console.log('🔧 [Planner] Repaired: Set default complexityScore');
            parsed.plan.complexityScore = 0.5;
          }
          if (typeof parsed.plan?.estimatedSteps !== 'number' || isNaN(parsed.plan.estimatedSteps)) {
            console.log('🔧 [Planner] Repaired: Set estimatedSteps from steps array length');
            parsed.plan.estimatedSteps = parsed.plan.steps?.length || 1;
          }

          // Fix: Ensure arrays exist and are arrays
          if (!Array.isArray(parsed.plan?.criticalPaths)) {
            console.log('🔧 [Planner] Repaired: Created default criticalPaths array');
            parsed.plan.criticalPaths = [1];
          }
          if (!Array.isArray(parsed.plan?.potentialIssues)) {
            console.log('🔧 [Planner] Repaired: Created default potentialIssues array');
            parsed.plan.potentialIssues = [];
          }
          if (!Array.isArray(parsed.plan?.optimizations)) {
            console.log('🔧 [Planner] Repaired: Created default optimizations array');
            parsed.plan.optimizations = [];
          }

          return JSON.stringify(parsed);
        } catch (parseError) {
          // If JSON parsing fails, return original text
          console.warn('🔧 [Planner] Could not repair JSON, returning original');
          return text;
        }
      },
    });

    const llmDuration = Date.now() - llmStartTime;
    console.log(`✅ [Planner] LLM responded in ${llmDuration}ms`);
    
    // Validate the result object exists
    if (!result?.object) {
      throw new Error('No object generated from LLM response');
    }
    
    const planningResult = result.object as PlanningResult;
    
    // Validate critical fields exist
    if (!planningResult?.plan || !planningResult?.plan?.steps || planningResult.plan.steps.length === 0) {
      throw new Error('Generated plan is missing required fields or has no steps');
    }
    
    // Log plan metrics
    console.log('📊 [Planner] Plan Metrics:');
    console.log('  - Steps:', planningResult.plan.steps.length);
    console.log('  - Estimated Steps:', planningResult.plan.estimatedSteps);
    console.log('  - Complexity Score:', Math.round(planningResult.plan.complexityScore * 100) + '%');
    console.log('  - Confidence:', Math.round(planningResult.confidence * 100) + '%');
    console.log('  - Critical Paths:', planningResult.plan.criticalPaths.length);
    console.log('  - Potential Issues:', planningResult.plan.potentialIssues.length);
    console.log('  - Optimizations:', planningResult.plan.optimizations.length);
    console.log('  - Has Optimized Query:', !!planningResult.optimizedQuery);
    console.log('  - Has Gaps:', (planningResult.gaps?.length || 0) > 0);
    
    // Log step breakdown
    const stepActions = planningResult.plan.steps.map(s => s.action);
    const actionCounts = stepActions.reduce((acc, action) => {
      acc[action] = (acc[action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log('📋 [Planner] Step Actions Breakdown:', JSON.stringify(actionCounts));
    
    // Log steps with fallbacks
    const stepsWithFallbacks = planningResult.plan.steps.filter(s => s.fallbackAction).length;
    console.log('🔄 [Planner] Steps with fallbacks:', stepsWithFallbacks);
    
    const totalDuration = Date.now() - startTime;
    console.log(`⏱️ [Planner] Total planning time: ${totalDuration}ms`);
    console.log(`✅ [Planner] Plan generation completed successfully`);
    
    return planningResult;
  } catch (error: any) {
    const totalDuration = Date.now() - startTime;
    console.error('❌ [Planner] Planning generation failed after', totalDuration, 'ms');
    console.error('❌ [Planner] Error type:', error?.name || 'Unknown');
    console.error('❌ [Planner] Error message:', error?.message || String(error));

    // Log request parameters for debugging
    console.error('❌ [Planner] Request Parameters:', {
      query: userQuery.substring(0, 100) + (userQuery.length > 100 ? '...' : ''),
      queryLength: userQuery.length,
      provider: opts.provider,
      model: opts.model || (opts.provider === 'gateway' ? 'google:gemini-2.5-flash' : 'gemini-2.5-flash'),
      hasApiKey: !!opts.apiKey,
      apiKeyLength: opts.apiKey?.length || 0,
      currentUrl: currentUrl || 'none',
      hasPageContext: !!pageContext,
      pageContextKeys: pageContext ? Object.keys(pageContext) : [],
    });

    // Use AI SDK's NoObjectGeneratedError check for better error handling
    // See: https://v6.ai-sdk.dev/docs/ai-sdk-core/generating-structured-data#error-handling
    const { NoObjectGeneratedError } = await import('ai');
    const isNoObjectError = NoObjectGeneratedError.isInstance?.(error) || error?.name === 'AI_NoObjectGeneratedError';

    if (isNoObjectError || error?.message?.includes('schema')) {
      console.error('❌ [Planner] Schema validation failed - LLM response did not match expected structure');
      console.error('❌ [Planner] This may indicate the model needs clearer instructions or the schema is too strict');

      // Log detailed error information if available
      if (isNoObjectError && error?.text) {
        console.error('❌ [Planner] LLM Raw Response (first 1000 chars):', error.text.substring(0, 1000));
        // Try to parse and show specific validation errors
        try {
          const parsed = JSON.parse(error.text);
          console.error('❌ [Planner] Parsed response structure:', {
            hasPlan: !!parsed.plan,
            hasSteps: !!parsed.plan?.steps,
            stepsCount: parsed.plan?.steps?.length || 0,
            hasConfidence: !!parsed.confidence || !!parsed.plan?.confidence,
            topLevelKeys: Object.keys(parsed),
            planKeys: parsed.plan ? Object.keys(parsed.plan) : [],
          });
        } catch (parseErr) {
          console.error('❌ [Planner] Failed to parse LLM response as JSON');
        }
      }
      if (error?.cause) {
        console.error('❌ [Planner] Validation cause:', error.cause);
      }
      if (error?.usage) {
        console.error('❌ [Planner] Token usage:', error.usage);
      }
    }

    if (error?.stack) {
      console.error('❌ [Planner] Error stack (first 500 chars):', error.stack.substring(0, 500));
    }
    
    // Fallback to simple plan if generation fails
    console.log('🔄 [Planner] Using fallback plan...');
    return {
      plan: {
        objective: userQuery,
        approach: 'Sequential execution with validation',
        steps: [
          {
            step: 1,
            action: 'getPageContext',
            target: 'current_page',
            reasoning: 'Need to understand current page state before proceeding',
            expectedOutcome: 'Page context retrieved (title, text, links, forms)',
            validationCriteria: 'Context object returned with title and URL',
          },
        ],
        criticalPaths: [1],
        estimatedSteps: 1,
        complexityScore: calculateComplexityScore(userQuery),
        potentialIssues: ['Planning generation failed, using fallback'],
        optimizations: [],
      },
      confidence: calculateConfidence(userQuery, calculateComplexityScore(userQuery), false),
    };
  }
}

/**
 * Dynamically calculate complexity score based on task characteristics
 */
function calculateComplexityScore(userQuery: string, steps?: any[]): number {
  const query = userQuery.toLowerCase();
  
  // Base complexity factors
  let complexity = 0.2; // Base complexity
  
  // Multi-step indicators
  const multiStepIndicators = ['then', 'and', 'after', 'next', 'finally'];
  const hasMultipleSteps = multiStepIndicators.some(indicator => query.includes(indicator)) || 
                          (steps && steps.length > 2);
  if (hasMultipleSteps) complexity += 0.3;
  
  // Form interaction
  const formIndicators = ['fill', 'form', 'input', 'submit', 'register', 'sign up', 'login'];
  const hasFormInteraction = formIndicators.some(indicator => query.includes(indicator));
  if (hasFormInteraction) complexity += 0.25;
  
  // Navigation complexity
  const navIndicators = ['navigate', 'browse', 'click', 'menu', 'tab', 'page'];
  const hasNavigation = navIndicators.some(indicator => query.includes(indicator));
  if (hasNavigation) complexity += 0.15;
  
  // Search and filtering
  const searchIndicators = ['search', 'find', 'filter', 'sort', 'query'];
  const hasSearch = searchIndicators.some(indicator => query.includes(indicator));
  if (hasSearch) complexity += 0.2;
  
  // Dynamic content
  const dynamicIndicators = ['load', 'wait', 'ajax', 'js', 'javascript', 'dynamic'];
  const hasDynamicContent = dynamicIndicators.some(indicator => query.includes(indicator));
  if (hasDynamicContent) complexity += 0.15;
  
  // URL complexity
  const urlMatch = userQuery.match(/https?:\/\/[^\s]+/g);
  if (urlMatch && urlMatch.length > 1) complexity += 0.1; // Multiple URLs
  if (urlMatch && urlMatch[0].includes('?')) complexity += 0.1; // Query parameters
  
  return Math.min(complexity, 1.0);
}

/**
 * Dynamically calculate confidence based on task clarity and complexity
 */
function calculateConfidence(userQuery: string, complexityScore: number, hasValidSteps?: boolean): number {
  let confidence = 0.9; // Base confidence
  
  // Reduce confidence for complex tasks
  confidence -= (complexityScore * 0.3);
  
  // Query clarity indicators
  const clearIndicators = ['navigate to', 'go to', 'open', 'visit', 'browse to'];
  const hasClearDirection = clearIndicators.some(indicator => userQuery.toLowerCase().includes(indicator));
  if (hasClearDirection) confidence += 0.05;
  
  // Vague or ambiguous queries
  const vagueIndicators = ['maybe', 'perhaps', 'try', 'might', 'could', 'somehow'];
  const hasVagueLanguage = vagueIndicators.some(indicator => userQuery.toLowerCase().includes(indicator));
  if (hasVagueLanguage) confidence -= 0.2;
  
  // Missing essential information
  if (!userQuery.match(/https?:\/\//) && !userQuery.toLowerCase().includes('navigate')) {
    confidence -= 0.1; // No clear destination
  }
  
  // Valid steps increase confidence
  if (hasValidSteps) confidence += 0.1;
  
  return Math.max(Math.min(confidence, 1.0), 0.1); // Clamp between 0.1 and 1.0
}

/**
 * Enhanced telemetry wrapper for planning (call from sidepanel.tsx)
 */
export async function generateExecutionPlanWithTelemetry(
  userQuery: string,
  opts: {
    provider: 'google' | 'gateway' | 'nim';
    apiKey: string;
    model?: string;
    braintrustApiKey?: string;
  },
  currentUrl?: string,
  pageContext?: any
): Promise<PlanningResult> {
  const { traced } = await import('./lib/braintrust');
  
  return await traced(
    'mandatory_planning_evaluator',
    async () => {
      try {
        const result = await generateExecutionPlan(userQuery, opts, currentUrl, pageContext);
        
        // Metrics are logged automatically by traced function via metadata
        return result;
      } catch (error: any) {
        // Error metadata is logged automatically by traced function
        throw error;
      }
    },
    {
      query: userQuery,
      currentUrl: currentUrl || 'unknown',
      provider: opts.provider,
      hasPageContext: !!pageContext,
      model: opts.model || (opts.provider === 'gateway' ? 'google:gemini-2.5-flash' : 'gemini-2.5-flash'),
    }
  );
}

/**
 * Format planning result into instruction set for computer-use agent
 */
export function formatPlanAsInstructions(plan: ExecutionPlan): string {
  const lines = [
    '# Execution Plan (GEPA-Optimized)',
    '',
    '⚠️ **MANDATORY:** This plan contains MULTIPLE steps that MUST ALL be executed in sequence.',
    'Do NOT stop after Step 1 (getPageContext). Continue with ALL remaining steps.',
    '',
    `**Objective:** ${plan.objective}`,
    `**Approach:** ${plan.approach}`,
    `**Complexity:** ${Math.round(plan.complexityScore * 100)}%`,
    `**Estimated Steps:** ${plan.estimatedSteps}`,
    `**Total Steps in Plan:** ${plan.steps.length} (all must be executed)`,
    '',
    '## Critical Path Steps',
    plan.criticalPaths.map(idx => `- Step ${idx + 1}: ${plan.steps[idx]?.action} - ${plan.steps[idx]?.target}`).join('\n'),
    '',
    '## Potential Issues & Mitigations',
    plan.potentialIssues.map((issue, i) => `${i + 1}. ${issue}`).join('\n'),
    '',
    '## Optimizations',
    plan.optimizations.map((opt, i) => `${i + 1}. ${opt}`).join('\n'),
    '',
    '## Step-by-Step Instructions (Execute ALL Steps)',
    '',
    `**IMPORTANT:** There are ${plan.steps.length} steps in this plan. Execute ALL of them unless the objective is explicitly achieved.`,
    '',
    ...plan.steps.map((step) => [
      `### Step ${step.step}: ${step.action.toUpperCase()}`,
      `**Target:** ${step.target}`,
      `**Reasoning:** ${step.reasoning}`,
      `**Expected Outcome:** ${step.expectedOutcome}`,
      step.validationCriteria ? `**Validation:** ${step.validationCriteria}` : '',
      step.fallbackAction ? `**Fallback:** If this fails, ${step.fallbackAction.action} ${step.fallbackAction.target} (${step.fallbackAction.reasoning})` : '',
      '',
    ].filter(Boolean).join('\n')),
  ];

  return lines.join('\n');
}

// Export dynamic calculation functions
export { calculateComplexityScore, calculateConfidence };
