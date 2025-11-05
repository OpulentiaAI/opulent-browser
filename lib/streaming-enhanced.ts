// Enhanced Streaming Step - Integrates all AI SDK v6 patterns
// Priority 1: Output strategies, approval flow ready, evaluation integration

import { Experimental_Agent as ToolLoopAgent, stepCountIs } from 'ai';
import type { StreamingStepOutput } from '../schemas/workflow-schemas';
import type { Message } from '../types';
import { logEvent, logStepProgress, logToolExecution } from '../lib/braintrust';
import {
  createEnhancedAgentConfig,
  AgentPerformanceMonitor,
} from '../lib/agent-enhancements';
import { streamingDebug, agentDebug, toolDebug } from '../lib/debug-logger';
import {
  createExecutionPlanOutput,
  createToolExecutionSummaryOutput,
  shouldAutoSubmitForApprovals,
} from '../lib/ai-sdk-6-enhancements';

interface EnhancedStreamingStepInput {
  model: any;
  system: string;
  tools: any;
  messages: Message[];
  execSteps: Array<{ step: number; action: string; url?: string; success: boolean }>;
  updateLastMessage: (updater: (msg: Message) => Message) => void;
  pushMessage: (msg: Message) => void;
  abortSignal?: AbortSignal;

  // Enhanced options
  enableStructuredOutput?: boolean;
  enableApprovalFlow?: boolean;
  onApprovalRequired?: (toolName: string, args: any) => Promise<boolean>;
  autoSubmitApprovals?: boolean;
}

interface EnhancedStreamingStepOutput extends StreamingStepOutput {
  // Structured output from agent
  structuredOutput?: {
    currentStep: number;
    totalSteps: number;
    completedSteps: number[];
    nextAction: string;
    confidence: number;
    blockers?: string[];
  };

  // Approval tracking
  approvalsRequested?: Array<{
    toolName: string;
    args: any;
    approved: boolean;
    timestamp: number;
  }>;

  // Auto-submit status
  autoSubmitted?: boolean;
}

/**
 * Enhanced Streaming Step - Integrates AI SDK v6 patterns
 *
 * Features:
 * 1. Structured output alongside tool execution
 * 2. Approval flow for sensitive operations
 * 3. Auto-submit after approvals
 * 4. Ready for evaluation integration
 *
 * Usage:
 * ```typescript
 * const result = await enhancedStreamingStep({
 *   model,
 *   system,
 *   tools,
 *   messages,
 *   execSteps,
 *   updateLastMessage,
 *   pushMessage,
 *   enableStructuredOutput: true,
 *   enableApprovalFlow: true,
 *   autoSubmitApprovals: true,
 * });
 *
 * console.log('Structured output:', result.structuredOutput);
 * console.log('Approvals:', result.approvalsRequested);
 * ```
 */
export async function enhancedStreamingStep(
  input: EnhancedStreamingStepInput
): Promise<EnhancedStreamingStepOutput> {
  "use step"; // Durable step with automatic retries

  const startTime = Date.now();
  const streamingTimer = streamingDebug.time('Enhanced Streaming Step');

  streamingDebug.info('Starting enhanced streaming step', {
    messageCount: input.messages?.length || 0,
    toolCount: Object.keys(input.tools || {}).length,
    enableStructuredOutput: input.enableStructuredOutput,
    enableApprovalFlow: input.enableApprovalFlow,
    autoSubmitApprovals: input.autoSubmitApprovals,
  });

  // Validate input
  if (!input.messages || !Array.isArray(input.messages) || input.messages.length === 0) {
    const errorMsg = `EnhancedStreamingStep: Invalid messages input`;
    streamingDebug.error('Invalid messages input', new Error(errorMsg));
    throw new Error(errorMsg);
  }

  logEvent('enhanced_streaming_step_start', {
    message_count: input.messages.length,
    tool_count: Object.keys(input.tools).length,
    enabled_features: {
      structured_output: input.enableStructuredOutput,
      approval_flow: input.enableApprovalFlow,
      auto_submit: input.autoSubmitApprovals,
    },
  });

  try {
    // Initialize performance monitoring
    const perfMonitor = new AgentPerformanceMonitor();
    const availableToolNames = Object.keys(input.tools || {});

    // Configure enhanced agent
    const enhancements = createEnhancedAgentConfig({
      dynamicModels: {
        fastModel: input.model,
        powerfulModel: (typeof input.model === 'string' && input.model.includes('gemini'))
          ? input.model.replace('flash-lite', 'flash').replace('flash', 'pro')
          : input.model,
        stepThreshold: 10,
        messageThreshold: 20,
      },
      reasoning: {
        enabled: true,
        effort: 'medium',
        exclude: false,
      },
      stopOnCompletion: false,
      stopOnExcessiveErrors: true,
      stopOnNavigationLoop: true,
      maxTokenBudget: 50000,
      contextManagement: {
        maxMessages: 40,
        keepSystemMessage: true,
        keepRecentCount: 25,
        summarizeOldMessages: true,
      },
      enablePerformanceMonitoring: true,
    });

    // Build agent configuration
    const agentConfig: any = {
      model: input.model,
      instructions: input.system,
      tools: Object.values(input.tools || {}),
      toolChoice: 'required',

      experimental_reasoning: {
        enabled: true,
        effort: 'medium',
        exclude: false,
      },

      stopWhen: [
        stepCountIs(100),
        ...enhancements.stopConditions.map(condition => async ({ steps }: any) => {
          if (steps.length < 3) return false;
          return await condition({ steps });
        }),
      ],

      prepareStep: async ({ stepNumber, messages, steps }: any) => {
        // Performance tracking
        if (steps.length > 0) {
          const lastStep = steps[steps.length - 1];
          if (lastStep?.usage) {
            const stepTime = Date.now() - startTime - (steps.length - 1) * 1000;
            perfMonitor.recordStepTime(stepTime);
          }
        }

        // Log progress
        if (stepNumber > 1 && stepNumber % 5 === 0) {
          logStepProgress('enhanced_streaming_step', stepNumber, {
            previous_steps_count: steps.length,
            messages_count: messages.length,
            performance: perfMonitor.getSummary(),
          });
        }

        // Get enhanced configuration
        const enhancedConfig = await enhancements.prepareStep({
          stepNumber,
          messages,
          steps,
        });

        const hasExecutedTool = steps.some((step: any) => (step.toolCalls?.length || 0) > 0);
        const mergedConfig: any = { ...enhancedConfig };

        if (!hasExecutedTool) {
          mergedConfig.toolChoice = 'required';
          mergedConfig.activeTools = mergedConfig.activeTools || availableToolNames;
        } else if (mergedConfig.toolChoice === undefined) {
          mergedConfig.toolChoice = 'auto';
        }

        return mergedConfig;
      },
    };

    // Add structured output if enabled
    if (input.enableStructuredOutput) {
      agentConfig.output = createExecutionPlanOutput();
      streamingDebug.info('Structured output enabled', {
        outputType: 'execution_plan',
      });
    }

    // Create agent
    const agent = new ToolLoopAgent(agentConfig);

    // Convert messages to AI SDK format
    const aiMessages = input.messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    streamingDebug.debug('Calling enhanced agent.stream()', {
      aiMessageCount: aiMessages.length,
      hasStructuredOutput: input.enableStructuredOutput,
    });

    // Stream agent response
    const agentTimer = agentDebug.time('Enhanced Agent Stream');
    const agentStream = await agent.stream({ messages: aiMessages });
    const result = await agentStream;
    agentTimer();

    streamingDebug.info('Enhanced agent stream initialized', {
      hasResult: !!result,
      hasFullStream: !!result.fullStream,
      hasStructuredOutput: input.enableStructuredOutput,
    });

    // Create assistant message
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      executionTrajectory: input.execSteps.map(s => ({
        step: s.step,
        action: s.action,
        url: s.url,
        success: s.success,
        timestamp: Date.now(),
      })),
      workflowTasks: [] as any,
    };
    input.pushMessage(assistantMessage);

    // Stream processing state
    let fullText = '';
    let textChunkCount = 0;
    let toolCallCount = 0;
    let stepCount = 0;
    let toolExecutions: Array<{ tool: string; success: boolean; duration: number }> = [];
    let lastFinishReason: string | undefined;
    const stepTimings: Array<{ step: number; start: number; end?: number; finishReason?: string }> = [];
    const toolTimings: Map<string, { start: number }> = new Map();
    let reasoning: string[] = [];
    let reasoningDetails: any[] = [];
    let approvalsRequested: Array<{
      toolName: string;
      args: any;
      approved: boolean;
      timestamp: number;
    }> = [];
    let structuredOutput: any = undefined;

    logEvent('enhanced_streaming_fullstream_start', {
      step_count: stepCount,
      tool_call_count: toolCallCount,
    });

    // Process full stream
    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'start-step':
          stepCount++;
          stepTimings.push({ step: stepCount, start: Date.now() });
          streamingDebug.debug('Step started', {
            stepNumber: stepCount,
            timestamp: Date.now(),
          });
          logStepProgress('enhanced_streaming_step', stepCount, {
            phase: 'start',
            total_steps_so_far: stepCount,
          });
          break;

        case 'reasoning-delta':
        case 'reasoning':
          const reasoningText = (part as any).text || (part as any).delta || '';
          if (reasoningText) {
            reasoning.push(reasoningText);
            input.updateLastMessage((msg) => ({
              ...msg,
              reasoning: reasoning.slice(),
            }));
            streamingDebug.debug('Reasoning captured', {
              reasoningLength: reasoningText.length,
              totalReasoning: reasoning.length,
            });
          }
          break;

        case 'reasoning-details':
          const details = (part as any).details || (part as any);
          reasoningDetails.push(details);
          streamingDebug.debug('Reasoning details captured', {
            type: details.type,
            hasText: !!details.text,
            hasSummary: !!details.summary,
          });
          break;

        case 'finish-step':
          const stepPart = part as any;
          const currentStep = stepTimings.find(s => s.step === stepCount && !s.end);
          if (currentStep) {
            currentStep.end = Date.now();
            currentStep.finishReason = stepPart.finishReason;
            const stepDuration = currentStep.end - currentStep.start;
            streamingDebug.debug('Step finished', {
              stepNumber: stepCount,
              finishReason: stepPart.finishReason,
              duration: stepDuration,
            });
            logStepProgress('enhanced_streaming_step', stepCount, {
              phase: 'finish',
              duration: stepDuration,
              finish_reason: stepPart.finishReason,
            });
          }
          break;

        case 'text-delta':
          textChunkCount++;
          fullText += (part as any).text;

          input.updateLastMessage((msg) => ({
            ...msg,
            content: msg.role === 'assistant' ? fullText : msg.content,
            executionTrajectory: input.execSteps.map(s => ({
              step: s.step,
              action: s.action,
              url: s.url,
              success: s.success,
              timestamp: Date.now(),
            })),
          }));

          if (textChunkCount % 10 === 0) {
            logEvent('text_stream_progress', {
              chunk_count: textChunkCount,
              text_length: fullText.length,
              step_number: stepCount,
            });
          }
          break;

        case 'tool-call':
          toolCallCount++;
          const toolCall = part as any;
          const toolName = toolCall.toolName || 'unknown';
          const toolCallId = toolCall.toolCallId || 'unknown';
          toolTimings.set(toolCallId, { start: Date.now() });

          toolDebug.debug('Tool call initiated', {
            toolName,
            toolCallId,
            callNumber: toolCallCount,
            stepNumber: stepCount,
            hasArgs: !!toolCall.args,
            args: toolCall.args,
          });

          logToolExecution(toolName, 'start', {
            tool_call_id: toolCallId,
            call_number: toolCallCount,
            step_number: stepCount,
            has_input: !!toolCall.args,
          });

          // Handle approval flow if enabled
          if (input.enableApprovalFlow && input.onApprovalRequired) {
            try {
              const requiresApproval = await input.onApprovalRequired(toolName, toolCall.args);

              if (requiresApproval) {
                streamingDebug.info('Approval required for tool', {
                  toolName,
                  args: toolCall.args,
                });

                approvalsRequested.push({
                  toolName,
                  args: toolCall.args,
                  approved: false, // Will be updated when user responds
                  timestamp: Date.now(),
                });

                // Update message to show approval pending
                input.updateLastMessage((msg) => {
                  const existingExecutions = msg.toolExecutions || [];
                  const toolExecution = {
                    toolCallId,
                    toolName,
                    state: 'approval-pending' as const,
                    input: toolCall.args || {},
                    timestamp: Date.now(),
                  };

                  return {
                    ...msg,
                    toolExecutions: [...existingExecutions, toolExecution],
                  };
                });

                continue; // Skip execution until approved
              }
            } catch (approvalError) {
              streamingDebug.error('Approval check failed', approvalError);
            }
          }

          // Normal tool execution tracking
          input.updateLastMessage((msg) => {
            const existingExecutions = msg.toolExecutions || [];
            const toolExecution = {
              toolCallId,
              toolName,
              state: 'input-streaming' as const,
              input: toolCall.args || {},
              timestamp: Date.now(),
            };

            const existingIndex = existingExecutions.findIndex(
              (exec) => exec.toolCallId === toolCallId
            );

            const updatedExecutions = existingIndex >= 0
              ? existingExecutions.map((exec, idx) =>
                  idx === existingIndex ? toolExecution : exec
                )
              : [...existingExecutions, toolExecution];

            return {
              ...msg,
              toolExecutions: updatedExecutions,
            };
          });
          break;

        case 'tool-result':
          const toolResult = part as any;
          const resultToolName = toolResult.toolName || 'unknown';
          const resultToolCallId = toolResult.toolCallId || 'unknown';
          const toolSuccess = !toolResult.result?.error && !toolResult.result?.isError;

          const toolTiming = toolTimings.get(resultToolCallId);
          const toolDuration = toolTiming ? Date.now() - toolTiming.start : 0;
          toolTimings.delete(resultToolCallId);

          toolDebug.info('Tool result received', {
            toolName: resultToolName,
            toolCallId: resultToolCallId,
            success: toolSuccess,
            duration: toolDuration,
            hasResult: !!toolResult.result,
          });

          toolExecutions.push({
            tool: resultToolName,
            success: toolSuccess,
            duration: toolDuration,
          });

          const finalState = toolSuccess ? 'output-available' : 'output-error';

          logToolExecution(resultToolName, 'complete', {
            tool_call_id: resultToolCallId,
            duration: toolDuration,
            success: toolSuccess,
            final_state: finalState,
          });

          input.updateLastMessage((msg) => {
            const existingExecutions = msg.toolExecutions || [];
            const toolExecution = {
              toolCallId: resultToolCallId,
              toolName: resultToolName,
              state: finalState as const,
              input: toolResult.args || {},
              output: toolSuccess ? toolResult.result : undefined,
              errorText: toolSuccess ? undefined : (toolResult.result?.error || 'Unknown error'),
              timestamp: Date.now(),
            };

            const existingIndex = existingExecutions.findIndex(
              (exec) => exec.toolCallId === resultToolCallId
            );

            const updatedExecutions = existingIndex >= 0
              ? existingExecutions.map((exec, idx) =>
                  idx === existingIndex ? toolExecution : exec
                )
              : [...existingExecutions, toolExecution];

            return {
              ...msg,
              toolExecutions: updatedExecutions,
            };
          });
          break;

        case 'finish':
          lastFinishReason = (part as any).finishReason;
          logEvent('enhanced_streaming_finished', {
            finish_reason: (part as any).finishReason,
            total_steps: stepCount,
            total_tool_calls: toolCallCount,
            total_text_chunks: textChunkCount,
          });
          break;

        case 'error':
          logEvent('enhanced_streaming_error', {
            error: (part as any).error,
            step_number: stepCount,
            tool_call_count: toolCallCount,
          });
          break;
      }
    }

    // Get final result
    const finalResult = await result;
    const finishReason = lastFinishReason || finalResult.finishReason;
    const usage = finalResult.usage instanceof Promise
      ? await finalResult.usage
      : finalResult.usage;

    // Get structured output if enabled
    if (input.enableStructuredOutput && (finalResult as any).output) {
      structuredOutput = (finalResult as any).output;
      streamingDebug.info('Structured output received', {
        hasOutput: !!structuredOutput,
        outputKeys: structuredOutput ? Object.keys(structuredOutput) : [],
      });
    }

    // Check for auto-submit
    let autoSubmitted = false;
    if (input.autoSubmitApprovals && approvalsRequested.length > 0) {
      if (shouldAutoSubmitForApprovals(input.messages)) {
        autoSubmitted = true;
        streamingDebug.info('Auto-submitting after all approvals resolved');
        logEvent('auto_submit_triggered', {
          approval_count: approvalsRequested.length,
        });
      }
    }

    const duration = Date.now() - startTime;

    // Update final message with reasoning
    if (reasoning.length > 0) {
      input.updateLastMessage((msg) => ({
        ...msg,
        reasoning: reasoning.slice(),
        reasoningDetails: reasoningDetails.length > 0 ? reasoningDetails : undefined,
      }));
    }

    // Calculate statistics
    const completedSteps = stepTimings.filter(s => s.end);
    const avgStepTime = completedSteps.length > 0
      ? completedSteps.reduce((sum, s) => sum + ((s.end! - s.start) || 0), 0) / completedSteps.length
      : 0;

    const performanceSummary = perfMonitor.getSummary();

    logEvent('enhanced_streaming_step_complete', {
      duration,
      execution_summary: {
        steps_executed: stepCount,
        avg_step_time: Math.round(avgStepTime),
        text_chunks: textChunkCount,
        tool_calls: toolCallCount,
        tool_executions: toolExecutions.length,
        finish_reason: finishReason,
        tokens: usage?.totalTokens || 0,
      },
      enhanced_features: {
        structured_output: !!structuredOutput,
        approvals_requested: approvalsRequested.length,
        auto_submitted: autoSubmitted,
      },
      performance_analysis: performanceSummary,
    });

    const output: EnhancedStreamingStepOutput = {
      fullText,
      textChunkCount,
      toolCallCount,
      toolExecutions,
      usage: usage ? {
        promptTokens: (usage as any).promptTokens || usage.inputTokens || 0,
        completionTokens: (usage as any).completionTokens || usage.outputTokens || 0,
        totalTokens: usage.totalTokens || 0,
      } : undefined,
      finishReason: String(finishReason || 'unknown'),
      duration,
      executionSteps: input.execSteps || [],
      reasoning: reasoning.length > 0 ? reasoning : undefined,
      reasoningDetails: reasoningDetails.length > 0 ? reasoningDetails : undefined,

      // Enhanced fields
      structuredOutput: structuredOutput || undefined,
      approvalsRequested: approvalsRequested.length > 0 ? approvalsRequested : undefined,
      autoSubmitted: autoSubmitted || undefined,
    } as any;

    streamingTimer();
    return output;

  } catch (error: any) {
    const duration = Date.now() - startTime;

    logEvent('enhanced_streaming_step_error', {
      duration,
      error_type: error?.name || typeof error,
      error_message: error?.message || String(error),
    });

    throw error;
  }
}
