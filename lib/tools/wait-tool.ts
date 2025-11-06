import { tool } from 'ai';
import { z } from 'zod';

/**
 * Enhanced Wait Tool - AI SDK 2.0 compliant
 * Provides type-safe waiting with comprehensive error handling
 */
export const waitTool = (executeTool: (toolName: string, params: any) => Promise<any>) => tool({
  description: 'Wait for a specified amount of time or for an element to appear on the page.',
  inputSchema: z.object({
    duration: z.number().optional().default(1000).describe('Duration to wait in milliseconds'),
    element: z.string().optional().describe('CSS selector of element to wait for'),
    timeout: z.number().optional().default(10000).describe('Maximum time to wait for element in milliseconds'),
    condition: z.enum(['visible', 'hidden', 'clickable', 'exist']).optional().default('visible').describe('Wait condition for element'),
  }),
  execute: async ({ 
    duration = 1000, 
    element, 
    timeout = 10000, 
    condition = 'visible' 
  }, { toolCallId, messages, abortSignal }) => {
    try {
      // Check for abort signal
      if (abortSignal?.aborted) {
        throw new Error('Wait operation aborted');
      }

      console.log(`⏱️ [Wait] Starting wait operation:`, { duration, element, timeout, condition });
      
      // Execute wait via context
      const result = await executeTool('wait', { 
        duration, 
        element, 
        timeout, 
        condition 
      });
      
      if (result?.error) {
        throw new Error(result.error);
      }
      
      console.log(`✅ [Wait] Successfully completed wait:`, result);
      
      return {
        success: true,
        waitDuration: result?.actualDuration || duration,
        elementFound: result?.elementFound || !element,
        element: result?.element || element,
        condition,
        timestamp: Date.now(),
        toolCallId,
      };
    } catch (error) {
      console.error(`❌ [Wait] Failed to wait:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown wait error',
        duration,
        timestamp: Date.now(),
        toolCallId,
      };
    }
  },
  onInputStart: () => {
    console.log('🔍 [Wait] Starting to generate wait parameters...');
  },
  onInputDelta: ({ inputTextDelta }) => {
    console.log(`📝 [Wait] Received input chunk: "${inputTextDelta}"`);
  },
  onInputAvailable: ({ input }) => {
    console.log(`✅ [Wait] Complete wait input:`, input);
  },
});