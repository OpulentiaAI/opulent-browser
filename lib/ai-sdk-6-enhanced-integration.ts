// AI SDK 6 Enhanced Tool System - Complete Implementation
// Strengthens execution reliability, view rendering, and deterministic returns

import { 
  generateText, 
  streamText, 
  tool, 
  dynamicTool,
  type LanguageModel, 
  type ToolSet,
  type ModelMessage,
  stepCountIs,
  NoSuchToolError,
  InvalidToolInputError,
  ToolCallRepairError,
} from 'ai';
import { z } from 'zod';

/**
 * Enhanced Tool Types with Full Type Safety
 */
export type ToolName = 'screenshot' | 'click' | 'type' | 'scroll' | 'navigate' | 'getPageContext' | 'getBrowserHistory' | 'wait' | 'pressKey' | 'keyCombo';

export interface ToolExecutionResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
  toolName: string;
  toolCallId: string;
}

export interface TypedToolCall<NAME extends string, ARGS> {
  type: 'tool-call';
  toolCallId: string;
  toolName: NAME;
  input: ARGS;
  timestamp: number;
}

export interface TypedToolResult<NAME extends string, ARGS, RESULT> {
  type: 'tool-result';
  toolCallId: string;
  toolName: NAME;
  input: ARGS;
  result: RESULT;
  success: boolean;
  error?: string;
  timestamp: number;
}

/**
 * Enhanced AI SDK 6 Integration with Approval Flow
// 
// CRITICAL DISCOVERY: experimental_needsApproval does NOT exist in AI SDK v6.0.0-beta.92
// After extensive testing and debugging, this API is not implemented in the current AI SDK version.
// All approval flow functionality below was built around a non-existent experimental API.
// 
// For future developers: Do not attempt to use experimental_needsApproval - it doesn't work.
// Approval flow must be implemented manually by wrapping tool execution at the workflow layer.
//
// TODO: Implement manual approval wrapping using the existing ApprovalModal infrastructure
// AI SDK 6 features
 */
export interface EnhancedToolConfig {
  maxSteps?: number;
  toolChoice?: 'auto' | 'required' | 'none' | { type: 'tool'; toolName: ToolName };
  stopWhen?: any; // StopCondition
  activeTools?: ToolName[];
  
  // Error handling and repair
  repairToolCall?: (context: {
    toolCall: any;
    error: Error;
    tools: any;
    inputSchema: any;
    messages: ModelMessage[];
    system?: string;
  }) => Promise<any>;
  
  // Multi-step execution support
  prepareStep?: (context: {
    model: LanguageModel;
    stepNumber: number;
    steps: any[];
    messages: ModelMessage[];
  }) => Promise<{
    model?: LanguageModel;
    toolChoice?: 'auto' | 'required' | 'none' | { type: 'tool'; toolName: ToolName };
    activeTools?: ToolName[];
    messages?: ModelMessage[];
  }> | undefined;
  
  // Callbacks for monitoring
  onStepStart?: (step: any) => void;
  onStepFinish?: (step: any) => void;
  onToolCall?: (toolCall: any) => void;
  onToolResult?: (result: any) => void;
  onToolError?: (error: Error, toolCall: any) => void;
  
  // Context passing
  experimental_context?: Record<string, any>;
}

/**
 * Browser Automation Tool Set with Enhanced Reliability
 */
export const createEnhancedBrowserToolSet = (executeTool: (toolName: string, params: any) => Promise<any>, onApprovalRequired?: (toolName: string, args: any) => Promise<boolean>) => {
  return {
    // Screenshot tool with comprehensive error handling
    screenshot: tool({
      description: 'Capture a screenshot of the current page',
      inputSchema: z.object({
        fullPage: z.boolean().optional().default(false),
        quality: z.number().min(0.1).max(1).optional().default(1.0),
        format: z.enum(['png', 'jpeg', 'webp']).optional().default('png'),
      }),
      async execute({ fullPage = false, quality = 1.0, format = 'png' }) {
        try {
          const result = await executeTool('screenshot', { fullPage, quality, format });
          if (result?.error) {
            throw new Error(result.error);
          }
          
          return {
            screenshot: result?.screenshot || '',
            fullPage,
            quality,
            format,
            timestamp: Date.now(),
            success: true,
          };
        } catch (error) {
          console.error('Screenshot tool failed:', error);
          return {
            error: error instanceof Error ? error.message : 'Unknown screenshot error',
            timestamp: Date.now(),
            success: false,
          };
        }
      },
    }),

    // Click tool with coordinate scaling and validation
    click: tool({
      description: 'Click at specified coordinates on the page',
      inputSchema: z.object({
        x: z.number().min(0).max(10000).describe('X coordinate (0-10000)'),
        y: z.number().min(0).max(10000).describe('Y coordinate (0-10000)'),
        button: z.enum(['left', 'right', 'middle']).optional().default('left'),
        double: z.boolean().optional().default(false),
        selector: z.string().optional().describe('CSS selector to click'),
      }),
      async execute({ x, y, button = 'left', double = false, selector }) {
        try {
          // Scale coordinates if not using selector
          let coords = { x, y };
          if (!selector) {
            const pageInfo = await executeTool('getPageContext', {});
            if (pageInfo?.viewport) {
              coords.x = Math.round((x / 1000) * pageInfo.viewport.width);
              coords.y = Math.round((y / 1000) * pageInfo.viewport.height);
            }
          }
          
          const result = await executeTool('click', { ...coords, button, double, selector });
          if (result?.error) {
            throw new Error(result.error);
          }
          
          return {
            ...coords,
            button,
            double,
            selector,
            success: true,
            timestamp: Date.now(),
          };
        } catch (error) {
          console.error('Click tool failed:', error);
          return {
            error: error instanceof Error ? error.message : 'Unknown click error',
            timestamp: Date.now(),
            success: false,
          };
        }
      },
    }),

    // Type text tool with comprehensive input handling
    type: tool({
      description: 'Type text into focused input element',
      inputSchema: z.object({
        text: z.string().describe('Text to type'),
        selector: z.string().optional().describe('CSS selector of target input'),
        clearFirst: z.boolean().optional().default(true),
        pressEnter: z.boolean().optional().default(false),
      }),
      experimental_needsApproval: async ({ text }) => {
        console.log('🔐 [APPROVAL] experimental_needsApproval called for type tool with text length:', text.length);
        if (onApprovalRequired && text.length > 100) {
          console.log('🔐 [APPROVAL] Text length > 100, calling onApprovalRequired callback...');
          const result = await onApprovalRequired('type', { text });
          console.log('🔐 [APPROVAL] onApprovalRequired returned:', result);
          return result;
        }
        console.log('🔐 [APPROVAL] Text length <= 100 or no callback, returning false');
        return false;
      },
      async execute({ text, selector, clearFirst = true, pressEnter = false }) {
        try {
          // Clear existing content if requested
          if (clearFirst) {
            await executeTool('keyCombo', { 
              keys: ['Control', 'a'] 
            });
            await new Promise(resolve => setTimeout(resolve, 50));
            await executeTool('pressKey', { key: 'Delete' });
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          
          const result = await executeTool('type', { 
            selector: selector || 'input:focus, textarea:focus, [contenteditable="true"]:focus',
            text,
          });
          
          if (result?.error) {
            throw new Error(result.error);
          }
          
          // Press enter if requested
          if (pressEnter) {
            await new Promise(resolve => setTimeout(resolve, 100));
            await executeTool('pressKey', { key: 'Enter' });
          }
          
          return {
            text,
            selector,
            clearFirst,
            pressEnter,
            success: true,
            timestamp: Date.now(),
          };
        } catch (error) {
          console.error('Type tool failed:', error);
          return {
            error: error instanceof Error ? error.message : 'Unknown type error',
            timestamp: Date.now(),
            success: false,
          };
        }
      },
    }),

    // Scroll tool with intelligent direction handling
    scroll: tool({
      description: 'Scroll the page or element',
      inputSchema: z.object({
        direction: z.enum(['up', 'down', 'left', 'right']).describe('Scroll direction'),
        amount: z.number().min(1).max(5000).optional().default(800),
        target: z.string().optional().describe('CSS selector of target element'),
      }),
      async execute({ direction, amount = 800, target }) {
        try {
          const result = await executeTool('scroll', { direction, amount, target });
          if (result?.error) {
            throw new Error(result.error);
          }
          
          return {
            direction,
            amount,
            target,
            success: true,
            timestamp: Date.now(),
          };
        } catch (error) {
          console.error('Scroll tool failed:', error);
          return {
            error: error instanceof Error ? error.message : 'Unknown scroll error',
            timestamp: Date.now(),
            success: false,
          };
        }
      },
    }),

    // Navigate tool with URL validation
    navigate: tool({
      description: 'Navigate to a URL',
      inputSchema: z.object({
        url: z.string().url().describe('URL to navigate to'),
        waitForLoad: z.boolean().optional().default(true),
        timeout: z.number().min(1000).max(60000).optional().default(30000),
      }),
      experimental_needsApproval: async ({ url }) => {
        console.log('🔐 [APPROVAL] experimental_needsApproval called for navigate tool with URL:', url);
        if (onApprovalRequired) {
          console.log('🔐 [APPROVAL] onApprovalRequired callback available, calling...');
          const result = await onApprovalRequired('navigate', { url });
          console.log('🔐 [APPROVAL] onApprovalRequired returned:', result);
          return result;
        }
        console.log('🔐 [APPROVAL] No onApprovalRequired callback, returning false');
        return false;
      },
      async execute({ url, waitForLoad = true, timeout = 30000 }) {
        try {
          const result = await executeTool('navigate', { url, waitForLoad, timeout });
          if (result?.error) {
            throw new Error(result.error);
          }
          
          return {
            url,
            success: true,
            timestamp: Date.now(),
          };
        } catch (error) {
          console.error('Navigate tool failed:', error);
          return {
            error: error instanceof Error ? error.message : 'Unknown navigation error',
            timestamp: Date.now(),
            success: false,
          };
        }
      },
    }),

    // Get page context with comprehensive analysis
    getPageContext: tool({
      description: 'Get comprehensive page context and metadata',
      inputSchema: z.object({
        includeContent: z.boolean().optional().default(true),
        includeLinks: z.boolean().optional().default(true),
        includeImages: z.boolean().optional().default(true),
        includeForms: z.boolean().optional().default(true),
        maxContentLength: z.number().min(100).max(10000).optional().default(5000),
      }),
      async execute({ includeContent = true, includeLinks = true, includeImages = true, includeForms = true, maxContentLength = 5000 }) {
        try {
          const result = await executeTool('getPageContext', {});
          if (result?.error) {
            throw new Error(result.error);
          }
          
          const context = { ...result };
          
          // Truncate content if too long
          if (context.text && context.text.length > maxContentLength) {
            context.text = context.text.substring(0, maxContentLength) + '...';
          }
          
          return {
            ...context,
            includeContent,
            includeLinks,
            includeImages,
            includeForms,
            success: true,
            timestamp: Date.now(),
          };
        } catch (error) {
          console.error('getPageContext tool failed:', error);
          return {
            error: error instanceof Error ? error.message : 'Unknown page context error',
            timestamp: Date.now(),
            success: false,
          };
        }
      },
    }),

    // Browser history tool
    getBrowserHistory: tool({
      description: 'Get browser history with search and filtering',
      inputSchema: z.object({
        query: z.string().optional().describe('Search term for history'),
        maxResults: z.number().min(1).max(100).optional().default(20),
        daysBack: z.number().min(1).max(365).optional().default(30),
      }),
      async execute({ query = '', maxResults = 20, daysBack = 30 }) {
        try {
          const startTime = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
          const result = await executeTool('getBrowserHistory', { query, maxResults, startTime });
          
          if (result?.error) {
            throw new Error(result.error);
          }
          
          return {
            history: result?.history || [],
            query,
            maxResults,
            daysBack,
            success: true,
            timestamp: Date.now(),
          };
        } catch (error) {
          console.error('getBrowserHistory tool failed:', error);
          return {
            error: error instanceof Error ? error.message : 'Unknown history error',
            timestamp: Date.now(),
            success: false,
          };
        }
      },
    }),

    // Wait tool
    wait: tool({
      description: 'Wait for specified duration',
      inputSchema: z.object({
        seconds: z.number().min(0.1).max(300).describe('Wait time in seconds'),
        reason: z.string().optional().describe('Reason for waiting'),
      }),
      async execute({ seconds, reason }) {
        try {
          await new Promise(resolve => setTimeout(resolve, seconds * 1000));
          
          return {
            seconds,
            reason,
            success: true,
            timestamp: Date.now(),
          };
        } catch (error) {
          console.error('Wait tool failed:', error);
          return {
            error: error instanceof Error ? error.message : 'Unknown wait error',
            timestamp: Date.now(),
            success: false,
          };
        }
      },
    }),

    // Keyboard key press
    pressKey: tool({
      description: 'Press a keyboard key',
      inputSchema: z.object({
        key: z.string().describe('Key to press (e.g., "Enter", "Tab", "Escape")'),
        selector: z.string().optional().describe('Target selector'),
      }),
      async execute({ key, selector }) {
        try {
          const result = await executeTool('pressKey', { key, selector });
          if (result?.error) {
            throw new Error(result.error);
          }
          
          return {
            key,
            selector,
            success: true,
            timestamp: Date.now(),
          };
        } catch (error) {
          console.error('pressKey tool failed:', error);
          return {
            error: error instanceof Error ? error.message : 'Unknown key press error',
            timestamp: Date.now(),
            success: false,
          };
        }
      },
    }),

    // Keyboard combination
    keyCombo: tool({
      description: 'Press keyboard key combination',
      inputSchema: z.object({
        keys: z.array(z.string()).describe('Keys to press (e.g., ["Control", "A"])'),
      }),
      async execute({ keys }) {
        try {
          const result = await executeTool('keyCombo', { keys });
          if (result?.error) {
            throw new Error(result.error);
          }
          
          return {
            keys,
            success: true,
            timestamp: Date.now(),
          };
        } catch (error) {
          console.error('keyCombo tool failed:', error);
          return {
            error: error instanceof Error ? error.message : 'Unknown key combo error',
            timestamp: Date.now(),
            success: false,
          };
        }
      },
    }),
  };
};

/**
 * Enhanced Tool Orchestrator with comprehensive error handling
 */
export class EnhancedToolOrchestrator {
  private toolSet: ReturnType<typeof createEnhancedBrowserToolSet>;
  private config: EnhancedToolConfig;
  
  constructor(executeTool: (toolName: string, params: any) => Promise<any>, config: EnhancedToolConfig = {}, onApprovalRequired?: (toolName: string, args: any) => Promise<boolean>) {
    this.toolSet = createEnhancedBrowserToolSet(executeTool, onApprovalRequired);
    this.config = {
      maxSteps: 15,
      toolChoice: 'auto',
      stopWhen: stepCountIs(15),
      continueOnError: true,
      ...config,
    };
  }

  /**
   * Execute tools with comprehensive error handling and validation
   */
  async execute(
    model: LanguageModel,
    messages: ModelMessage[],
    options: {
      toolChoice?: 'auto' | 'required' | 'none';
      maxSteps?: number;
      experimental_context?: Record<string, any>;
    } = {}
  ) {
    try {
      // First, try with the enhanced tool set
      const result = await generateText({
        model,
        messages,
        tools: this.toolSet,
        toolChoice: options.toolChoice || this.config.toolChoice as any,
        maxSteps: options.maxSteps || this.config.maxSteps,
        stopWhen: this.config.stopWhen,
        activeTools: this.config.activeTools as any,
        experimental_context: options.experimental_context || this.config.experimental_context,
        prepareStep: this.config.prepareStep as any,
        repairToolCall: this.config.repairToolCall,
        onStepStart: this.config.onStepStart,
        onStepFinish: this.config.onStepFinish,
        onToolCall: this.config.onToolCall,
        onToolResult: this.config.onToolResult,
        onToolError: this.config.onToolError,
      });

      return {
        success: true,
        text: result.text,
        toolCalls: result.toolCalls,
        toolResults: result.toolResults,
        steps: result.steps,
        usage: result.usage,
        messages: result.response?.messages || [],
      };
    } catch (error) {
      // Enhanced error handling with repair attempts
      if (error instanceof Error) {
        if (NoSuchToolError.isInstance(error)) {
          console.error('❌ [Enhanced Tool] Unknown tool called:', error);
          throw new Error(`Tool "${error.toolName}" does not exist. Available tools: ${Object.keys(this.toolSet).join(', ')}`);
        } else if (InvalidToolInputError.isInstance(error)) {
          console.error('❌ [Enhanced Tool] Invalid tool input:', error);
          throw new Error(`Invalid input for tool "${error.toolName}": ${error.message}`);
        } else {
          console.error('❌ [Enhanced Tool] Execution failed:', error);
          throw error;
        }
      }
      throw error;
    }
  }

  /**
   * Stream tool execution with real-time updates
   */
  async *streamExecution(
    model: LanguageModel,
    messages: ModelMessage[],
    options: {
      toolChoice?: 'auto' | 'required' | 'none';
      maxSteps?: number;
      experimental_context?: Record<string, any>;
    } = {}
  ) {
    try {
      const stream = streamText({
        model,
        tools: this.toolSet,
        messages,
        toolChoice: options.toolChoice || this.config.toolChoice as any,
        maxSteps: options.maxSteps || this.config.maxSteps,
        stopWhen: this.config.stopWhen,
        activeTools: this.config.activeTools as any,
        experimental_context: options.experimental_context || this.config.experimental_context,
        prepareStep: this.config.prepareStep as any,
        repairToolCall: this.config.repairToolCall,
        onStepStart: this.config.onStepStart,
        onStepFinish: this.config.onStepFinish,
        onToolCall: this.config.onToolCall,
        onToolResult: this.config.onToolResult,
        onToolError: this.config.onToolError,
      });

      for await (const chunk of stream.textStream) {
        yield { type: 'text', content: chunk };
      }

      const result = await stream.result;
      yield { type: 'complete', result };
    } catch (error) {
      yield { type: 'error', error };
    }
  }

  /**
   * Get the tool set for external use
   */
  getToolSet() {
    return this.toolSet;
  }

  /**
   * Add a dynamic tool at runtime
   */
  addDynamicTool(name: string, toolConfig: any) {
    this.toolSet[name as keyof typeof this.toolSet] = dynamicTool(toolConfig);
    console.log(`✅ [Enhanced Tool] Added dynamic tool: ${name}`);
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<EnhancedToolConfig>) {
    this.config = { ...this.config, ...newConfig };
  }
}

/**
 * Tool View Renderer with Enhanced UI Components
 */
export class EnhancedToolViewRenderer {
  /**
   * Render tool execution with real-time status updates
   */
  static renderToolExecution(
    toolExecutions: Array<{
      toolCallId: string;
      toolName: string;
      state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
      input?: Record<string, unknown>;
      output?: Record<string, unknown>;
      errorText?: string;
      timestamp?: number;
    }>,
    options: {
      showInput?: boolean;
      showOutput?: boolean;
      compact?: boolean;
    } = {}
  ) {
    if (!toolExecutions || toolExecutions.length === 0) {
      return null;
    }

    return {
      type: 'tool-execution',
      executions: toolExecutions,
      options,
      timestamp: Date.now(),
    };
  }

  /**
   * Create deterministic tool result structure
   */
  static createDeterministicResult<T>(
    success: boolean,
    data?: T,
    error?: string,
    metadata?: Record<string, any>
  ): ToolExecutionResult<T> {
    return {
      success,
      data,
      error,
      timestamp: Date.now(),
      toolName: metadata?.toolName || 'unknown',
      toolCallId: metadata?.toolCallId || `tool_${Date.now()}`,
    };
  }

  /**
   * Validate tool result against expected schema
   */
  static validateToolResult<T>(
    result: ToolExecutionResult<T>,
    schema: z.ZodType<T>
  ): { valid: boolean; data?: T; error?: string } {
    try {
      if (!result.success) {
        return { valid: false, error: result.error || 'Tool execution failed' };
      }

      const parsed = schema.parse(result.data);
      return { valid: true, data: parsed };
    } catch (error) {
      return { 
        valid: false, 
        error: error instanceof Error ? error.message : 'Validation failed' 
      };
    }
  }
}