import { tool } from 'ai';
import { z } from 'zod';

/**
 * Enhanced Scroll Tool - AI SDK 2.0 compliant
 * Provides type-safe page scrolling with comprehensive error handling
 */
export const scrollTool = (executeTool: (toolName: string, params: any) => Promise<any>) => tool({
  description: 'Scroll the page in specified direction or to specific coordinates with smooth animations.',
  inputSchema: z.object({
    direction: z.enum(['up', 'down', 'left', 'right']).optional().describe('Direction to scroll'),
    amount: z.number().optional().default(500).describe('Pixels to scroll in the specified direction'),
    x: z.number().optional().describe('X coordinate to scroll to'),
    y: z.number().optional().describe('Y coordinate to scroll to'),
    smooth: z.boolean().optional().default(true).describe('Use smooth scrolling animation'),
    element: z.string().optional().describe('CSS selector of element to scroll'),
  }),
  execute: async ({ 
    direction, 
    amount = 500, 
    x, 
    y, 
    smooth = true, 
    element 
  }, { toolCallId, messages, abortSignal }) => {
    try {
      // Check for abort signal
      if (abortSignal?.aborted) {
        throw new Error('Scroll operation aborted');
      }

      // Validate input
      if (!direction && (x === undefined || y === undefined)) {
        throw new Error('Either direction or both x and y coordinates must be provided');
      }

      console.log(`📜 [Scroll] Starting scroll operation:`, { direction, amount, x, y, smooth, element });
      
      // Execute scroll via context
      const result = await executeTool('scroll', { 
        direction, 
        amount, 
        x, 
        y, 
        smooth, 
        element 
      });
      
      if (result?.error) {
        throw new Error(result.error);
      }
      
      console.log(`✅ [Scroll] Successfully scrolled:`, result);
      
      return {
        success: true,
        scrollDirection: direction,
        scrollAmount: amount,
        finalPosition: result?.finalPosition || { x, y },
        element: result?.element || element,
        smooth,
        timestamp: Date.now(),
        toolCallId,
      };
    } catch (error) {
      console.error(`❌ [Scroll] Failed to scroll:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown scroll error',
        direction,
        timestamp: Date.now(),
        toolCallId,
      };
    }
  },
  onInputStart: () => {
    console.log('🔍 [Scroll] Starting to generate scroll parameters...');
  },
  onInputDelta: ({ inputTextDelta }) => {
    console.log(`📝 [Scroll] Received input chunk: "${inputTextDelta}"`);
  },
  onInputAvailable: ({ input }) => {
    console.log(`✅ [Scroll] Complete scroll input:`, input);
  },
});