// Evaluation Step - Implements AI SDK 6 Evaluator-Optimizer Pattern
// Uses 'use step' directive for durable execution
// See: https://v6.ai-sdk.dev/docs/agents/workflows

import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import type { StreamingStepOutput } from '../schemas/workflow-schemas';
import { logEvent, logStepProgress } from '../lib/braintrust';
import { evaluatorDebug } from '../lib/debug-logger';

export interface EvaluationStepInput {
  model: any;
  executionResult: StreamingStepOutput;
  originalQuery: string;
  plan?: {
    steps: Array<{
      action: string;
      target?: string;
      expectedOutcome?: string;
    }>;
  };
  evaluationCriteria?: {
    requiredTools?: string[];
    minSuccessRate?: number;
    maxErrors?: number;
    textMinLength?: number;
    customCriteria?: string;
  };
}

export interface EvaluationStepOutput {
  quality: 'excellent' | 'good' | 'acceptable' | 'poor' | 'failed';
  score: number; // 0-1
  completeness: number; // 0-1 - how much of the plan was completed
  correctness: number; // 0-1 - how correct the execution was
  issues: string[];
  successes: string[];
  recommendations: string[];
  shouldRetry: boolean;
  shouldProceed: boolean;
  retryStrategy?: {
    approach: string;
    focusAreas: string[];
    modifications: string[];
  };
  duration: number;
}

const EvaluationSchema = z.object({
  quality: z.enum(['excellent', 'good', 'acceptable', 'poor', 'failed'])
    .describe('Overall quality of execution'),
  score: z.number().min(0).max(1)
    .describe('Numerical score from 0 to 1'),
  completeness: z.number().min(0).max(1)
    .describe('How much of the planned work was completed (0-1)'),
  correctness: z.number().min(0).max(1)
    .describe('How correct the execution was (0-1)'),
  issues: z.array(z.string())
    .describe('List of issues or problems encountered'),
  successes: z.array(z.string())
    .describe('List of successful actions and outcomes'),
  recommendations: z.array(z.string())
    .describe('Specific recommendations for improvement'),
  shouldRetry: z.boolean()
    .describe('Whether execution should be retried'),
  shouldProceed: z.boolean()
    .describe('Whether execution quality is sufficient to proceed'),
  retryStrategy: z.object({
    approach: z.string().describe('Overall approach for retry'),
    focusAreas: z.array(z.string()).describe('Specific areas to focus on'),
    modifications: z.array(z.string()).describe('Specific modifications to make'),
  }).optional().describe('Strategy for retry if needed'),
});

/**
 * Evaluation Step - Assesses execution quality and determines next actions
 * Implements the Evaluator-Optimizer pattern from AI SDK 6 workflows
 */
export async function evaluationStep(
  input: EvaluationStepInput
): Promise<EvaluationStepOutput> {
  "use step"; // Makes this a durable step with automatic retries

  const startTime = Date.now();
  const timer = evaluatorDebug.time('Evaluation Step');

  evaluatorDebug.info('Starting evaluation step', {
    query: input.originalQuery,
    toolExecutionCount: input.executionResult.toolExecutions?.length || 0,
    textLength: input.executionResult.fullText?.length || 0,
    finishReason: input.executionResult.finishReason,
    hasModel: !!input.model,
    hasPlan: !!input.plan,
    planSteps: input.plan?.steps?.length || 0,
  });

  logEvent('evaluation_step_start', {
    tool_execution_count: input.executionResult.toolExecutions?.length || 0,
    text_length: input.executionResult.fullText?.length || 0,
    finish_reason: input.executionResult.finishReason,
    has_model: !!input.model,
    has_plan: !!input.plan,
    plan_steps: input.plan?.steps?.length || 0,
    execution_result_keys: Object.keys(input.executionResult || {}),
  });

  try {
    // Build evaluation prompt with execution context
    const toolExecutionsSummary = (input.executionResult.toolExecutions || [])
      .map((t, idx) => `${idx + 1}. ${t.tool}: ${t.success ? '✓ success' : '✗ failed'} (${t.duration}ms)`)
      .join('\n');

    const planStepsSummary = input.plan?.steps
      ? input.plan.steps
          .map((s, idx) => `${idx + 1}. ${s.action}(${s.target}) - Expected: ${s.expectedOutcome}`)
          .join('\n')
      : 'No plan provided';

    const systemPrompt = `You are an execution quality evaluator for browser automation tasks.

Your role is to assess whether the agent successfully completed the user's request by analyzing:
1. Tool execution results (success/failure, timing)
2. The original execution plan vs actual execution
3. The final text output explaining what was done
4. Any errors or issues encountered

Provide a comprehensive evaluation with:
- Quality rating (excellent/good/acceptable/poor/failed)
- Numerical scores for completeness and correctness
- Specific issues and successes
- Clear recommendations for improvement
- Decision on whether to retry or proceed

Be strict but fair. Consider:
- Did all required tools execute successfully?
- Was the original query fully addressed?
- Were there any critical errors?
- Is the output coherent and accurate?`;

    const evaluationPrompt = `Evaluate the following browser automation execution:

**Original Query:**
${input.originalQuery}

**Execution Plan:**
${planStepsSummary}

**Tool Executions:**
${toolExecutionsSummary}

**Execution Summary:**
- Total steps: ${input.executionResult.toolCallCount || 0}
- Tool executions: ${input.executionResult.toolExecutions?.length || 0}
- Success rate: ${calculateSuccessRate(input.executionResult)}%
- Text output length: ${input.executionResult.fullText?.length || 0} chars
- Finish reason: ${input.executionResult.finishReason}

**Agent Output:**
${input.executionResult.fullText || '(No text output)'}

**Evaluation Criteria:**
${input.evaluationCriteria?.customCriteria || 'Standard quality criteria'}
- Required tools: ${input.evaluationCriteria?.requiredTools?.join(', ') || 'Not specified'}
- Min success rate: ${(input.evaluationCriteria?.minSuccessRate || 0.7) * 100}%
- Max errors: ${input.evaluationCriteria?.maxErrors || 3}

Provide a comprehensive evaluation of this execution.`;

    evaluatorDebug.info('Calling generateObject for evaluation', {
      modelType: typeof input.model,
      hasSchema: !!EvaluationSchema,
      promptLength: evaluationPrompt.length,
      systemPromptLength: systemPrompt.length,
    });

    logEvent('evaluation_generate_object_start', {
      model_type: typeof input.model,
      prompt_length: evaluationPrompt.length,
      system_prompt_length: systemPrompt.length,
    });

    // Generate structured evaluation using AI SDK
    // Using schemaName and schemaDescription for better LLM guidance
    const result = await generateObject({
      model: input.model,
      schema: EvaluationSchema,
      schemaName: 'ExecutionEvaluation',
      schemaDescription: 'Evaluation of browser automation execution quality and completeness',
      system: systemPrompt,
      prompt: evaluationPrompt,
      maxRetries: 2,
      // Repair malformed JSON if needed
      experimental_repairText: async ({ text, error }) => {
        evaluatorDebug.warn('Attempting to repair malformed JSON', {
          errorType: error?.constructor?.name,
          textLength: text?.length,
        });
        
        // Try adding closing braces if missing
        if (text && !text.trim().endsWith('}')) {
          return text + '}';
        }
        return text;
      },
    });

    const duration = Date.now() - startTime;
    timer();

    evaluatorDebug.info('generateObject completed successfully', {
      hasResult: !!result,
      hasObject: !!result?.object,
      objectKeys: result?.object ? Object.keys(result.object) : [],
      duration,
    });

    logEvent('evaluation_generate_object_success', {
      has_result: !!result,
      has_object: !!result?.object,
      duration,
    });

    evaluatorDebug.info('Evaluation completed', {
      quality: result.object.quality,
      score: result.object.score,
      completeness: result.object.completeness,
      correctness: result.object.correctness,
      shouldRetry: result.object.shouldRetry,
      shouldProceed: result.object.shouldProceed,
      issueCount: result.object.issues.length,
      duration,
    });

    logEvent('evaluation_step_complete', {
      quality: result.object.quality,
      score: result.object.score,
      completeness: result.object.completeness,
      correctness: result.object.correctness,
      should_retry: result.object.shouldRetry,
      should_proceed: result.object.shouldProceed,
      issue_count: result.object.issues.length,
      success_count: result.object.successes.length,
      duration,
    });

    return {
      ...result.object,
      duration,
    };

  } catch (error: any) {
    const duration = Date.now() - startTime;
    timer();

    const errorDetails = {
      message: error?.message || String(error),
      name: error?.name,
      stack: error?.stack?.split('\n').slice(0, 3).join('\n'),
      cause: error?.cause,
      code: error?.code,
      type: typeof error,
      isAISDKError: error?.constructor?.name?.includes('AI'),
      errorKeys: error ? Object.keys(error) : [],
    };

    evaluatorDebug.error('Evaluation step failed', errorDetails);

    logEvent('evaluation_step_error', {
      error_message: errorDetails.message,
      error_name: errorDetails.name,
      error_type: errorDetails.type,
      is_ai_sdk_error: errorDetails.isAISDKError,
      error_code: errorDetails.code,
      duration,
      input_has_model: !!input.model,
      input_has_execution_result: !!input.executionResult,
      execution_result_keys: input.executionResult ? Object.keys(input.executionResult) : [],
    });

    // Log detailed context for debugging
    console.error('[EVALUATION-ERROR] Full error context:', JSON.stringify({
      error: errorDetails,
      input: {
        hasModel: !!input.model,
        modelType: typeof input.model,
        hasExecutionResult: !!input.executionResult,
        executionResultKeys: input.executionResult ? Object.keys(input.executionResult) : [],
        toolExecutionCount: input.executionResult?.toolExecutions?.length || 0,
        hasPlan: !!input.plan,
        planSteps: input.plan?.steps?.length || 0,
      },
    }, null, 2));

    // Also log to evaluator debug
    evaluatorDebug.error('[EVALUATION-ERROR] Detailed error:', {
      message: errorDetails.message,
      name: errorDetails.name,
      stack: errorDetails.stack,
      isAISDKError: errorDetails.isAISDKError,
    });

    // Return a fallback evaluation on error
    return {
      quality: 'poor',
      score: 0.5,
      completeness: 0.5,
      correctness: 0.5,
      issues: [
        `Evaluation failed: ${errorDetails.message}`,
        `Error type: ${errorDetails.name || errorDetails.type}`,
        errorDetails.isAISDKError ? 'AI SDK error detected' : 'Non-AI SDK error',
      ],
      successes: [],
      recommendations: [
        'Retry evaluation with different model or criteria',
        'Check model configuration and API keys',
        'Verify execution result structure',
      ],
      shouldRetry: false,
      shouldProceed: true, // Proceed despite evaluation failure
      duration,
    };
  }
}

/**
 * Calculate success rate from execution result
 */
function calculateSuccessRate(result: StreamingStepOutput): number {
  if (!result.toolExecutions || result.toolExecutions.length === 0) {
    return 0;
  }

  const successCount = result.toolExecutions.filter(t => t.success).length;
  return Math.round((successCount / result.toolExecutions.length) * 100);
}

/**
 * Helper to determine if evaluation suggests immediate retry
 */
export function shouldImmediatelyRetry(evaluation: EvaluationStepOutput): boolean {
  return (
    evaluation.shouldRetry &&
    evaluation.quality === 'poor' &&
    evaluation.issues.length > 0 &&
    evaluation.retryStrategy !== undefined
  );
}

/**
 * Helper to format evaluation for display
 */
export function formatEvaluationSummary(evaluation: EvaluationStepOutput): string {
  const scoreEmoji = evaluation.score >= 0.8 ? '🌟' : evaluation.score >= 0.6 ? '👍' : '⚠️';

  const sections = [
    `## ${scoreEmoji} Execution Evaluation`,
    '',
    `**Quality:** ${evaluation.quality.toUpperCase()}`,
    `**Score:** ${(evaluation.score * 100).toFixed(0)}/100`,
    `**Completeness:** ${(evaluation.completeness * 100).toFixed(0)}%`,
    `**Correctness:** ${(evaluation.correctness * 100).toFixed(0)}%`,
    '',
  ];

  if (evaluation.successes.length > 0) {
    sections.push('### ✅ Successes');
    evaluation.successes.forEach(s => sections.push(`- ${s}`));
    sections.push('');
  }

  if (evaluation.issues.length > 0) {
    sections.push('### ❌ Issues');
    evaluation.issues.forEach(i => sections.push(`- ${i}`));
    sections.push('');
  }

  if (evaluation.recommendations.length > 0) {
    sections.push('### 💡 Recommendations');
    evaluation.recommendations.forEach(r => sections.push(`- ${r}`));
    sections.push('');
  }

  if (evaluation.retryStrategy) {
    sections.push('### 🔄 Retry Strategy');
    sections.push(`**Approach:** ${evaluation.retryStrategy.approach}`);
    sections.push('');
    sections.push('**Focus Areas:**');
    evaluation.retryStrategy.focusAreas.forEach(f => sections.push(`- ${f}`));
    sections.push('');
    sections.push('**Modifications:**');
    evaluation.retryStrategy.modifications.forEach(m => sections.push(`- ${m}`));
  }

  sections.push('');
  sections.push(`**Decision:** ${evaluation.shouldProceed ? '✓ Proceed' : evaluation.shouldRetry ? '🔄 Retry' : '⏸️ Manual Review'}`);

  return sections.join('\n');
}
