import { tool } from 'ai';
import { z } from 'zod';

/**
 * Enhanced Type Tool - AI SDK 2.0 compliant
 * Provides type-safe text input with comprehensive error handling
 */
export const typeTool = (executeTool: (toolName: string, params: any) => Promise<any>) => tool({
  description: 'Type text into an input field or textarea. Handles element selection and text validation.',
  inputSchema: z.object({
    selector: z.string().describe('CSS selector of the input element or textarea'),
    text: z.string().describe('Text to type into the element'),
    clearFirst: z.boolean().optional().default(false).describe('Clear existing text before typing'),
    delay: z.number().optional().default(50).describe('Delay between keystrokes in milliseconds'),
    waitForElement: z.boolean().optional().default(true).describe('Wait for element to be available before typing'),
    timeout: z.number().optional().default(5000).describe('Timeout for element wait in milliseconds'),
  }),
  execute: async ({ 
    selector, 
    text, 
    clearFirst = false, 
    delay = 50, 
    waitForElement = true, 
    timeout = 5000 
  }, { toolCallId, messages, abortSignal }) => {
    try {
      // Check for abort signal
      if (abortSignal?.aborted) {
        throw new Error('Type operation aborted');
      }

      // Validate input
      if (!selector) {
        throw new Error('Selector is required for type operation');
      }
      if (text === undefined) {
        throw new Error('Text is required for type operation');
      }

      console.log(`⌨️ [Type] Starting type operation:`, { selector, textLength: text.length, clearFirst, delay });
      
      // Execute typing via context
      const result = await executeTool('type', { 
        selector, 
        text, 
        clearFirst, 
        delay, 
        waitForElement, 
        timeout 
      });
      
      if (result?.error) {
        throw new Error(result.error);
      }
      
      console.log(`✅ [Type] Successfully typed text:`, result);
      
      return {
        success: true,
        typedText: text,
        element: result?.element || selector,
        cleared: clearFirst,
        charactersTyped: text.length,
        timestamp: Date.now(),
        toolCallId,
      };
    } catch (error) {
      console.error(`❌ [Type] Failed to type text:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown type error',
        selector,
        text,
        timestamp: Date.now(),
        toolCallId,
      };
    }
  },
  onInputStart: () => {
    console.log('🔍 [Type] Starting to generate type parameters...');
  },
  onInputDelta: ({ inputTextDelta }) => {
    console.log(`📝 [Type] Received input chunk: "${inputTextDelta}"`);
  },
  onInputAvailable: ({ input }) => {
    console.log(`✅ [Type] Complete type input:`, { 
      selector: input.selector, 
      textLength: input.text?.length || 0,
      clearFirst: input.clearFirst 
    });
  },
});