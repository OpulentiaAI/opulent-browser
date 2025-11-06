import { tool } from 'ai';
import { z } from 'zod';

/**
 * Enhanced Click Tool - AI SDK 2.0 compliant
 * Provides type-safe element clicking with comprehensive error handling
 */
export const clickTool = (executeTool: (toolName: string, params: any) => Promise<any>) => tool({
  description: 'Click on an element at specified coordinates or via CSS selector. Handles coordinate scaling and validation.',
  inputSchema: z.object({
    selector: z.string().optional().describe('CSS selector of the element to click'),
    x: z.number().optional().min(0).max(10000).describe('X coordinate (0-10000) if not using selector'),
    y: z.number().optional().min(0).max(10000).describe('Y coordinate (0-10000) if not using selector'),
    button: z.enum(['left', 'right', 'middle']).optional().default('left').describe('Mouse button to use'),
    double: z.boolean().optional().default(false).describe('Perform double click instead of single click'),
    waitForElement: z.boolean().optional().default(true).describe('Wait for element to be available before clicking'),
    timeout: z.number().optional().default(5000).describe('Timeout for element wait in milliseconds'),
  }),
  execute: async ({ 
    selector, 
    x, 
    y, 
    button = 'left', 
    double = false, 
    waitForElement = true, 
    timeout = 5000 
  }, { toolCallId, messages, abortSignal }) => {
    try {
      // Check for abort signal
      if (abortSignal?.aborted) {
        throw new Error('Click operation aborted');
      }

      // Validate input
      if (!selector && (x === undefined || y === undefined)) {
        throw new Error('Either selector or both x and y coordinates must be provided');
      }

      console.log(`🖱️ [Click] Starting click operation:`, { selector, x, y, button, double });
      
      // Execute click via context
      const result = await executeTool('click', { 
        selector, 
        x, 
        y, 
        button, 
        double, 
        waitForElement, 
        timeout 
      });
      
      if (result?.error) {
        throw new Error(result.error);
      }
      
      console.log(`✅ [Click] Successfully clicked:`, result);
      
      return {
        success: true,
        clickedElement: result?.element || selector || `element at (${x}, ${y})`,
        coordinates: result?.coordinates || { x, y },
        button,
        double,
        timestamp: Date.now(),
        toolCallId,
      };
    } catch (error) {
      console.error(`❌ [Click] Failed to click:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown click error',
        selector,
        coordinates: { x, y },
        timestamp: Date.now(),
        toolCallId,
      };
    }
  },
  onInputStart: () => {
    console.log('🔍 [Click] Starting to generate click parameters...');
  },
  onInputDelta: ({ inputTextDelta }) => {
    console.log(`📝 [Click] Received input chunk: "${inputTextDelta}"`);
  },
  onInputAvailable: ({ input }) => {
    console.log(`✅ [Click] Complete click input:`, input);
  },
});