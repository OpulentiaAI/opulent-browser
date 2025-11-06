import { tool } from 'ai';
import { z } from 'zod';

/**
 * Enhanced Screenshot Tool - AI SDK 2.0 compliant
 * Provides type-safe screenshot capture with comprehensive error handling
 */
export const screenshotTool = (executeTool: (toolName: string, params: any) => Promise<any>) => tool({
  description: 'Capture a screenshot of the current page with configurable quality and format.',
  inputSchema: z.object({
    fullPage: z.boolean().optional().default(false).describe('Capture the full page or just the visible viewport'),
    quality: z.number().optional().min(0.1).max(1).default(1.0).describe('Image quality from 0.1 to 1.0'),
    format: z.enum(['png', 'jpeg', 'webp']).optional().default('png').describe('Image format for the screenshot'),
  }),
  execute: async ({ 
    fullPage = false, 
    quality = 1.0, 
    format = 'png' 
  }, { toolCallId, messages, abortSignal }) => {
    try {
      // Check for abort signal
      if (abortSignal?.aborted) {
        throw new Error('Screenshot operation aborted');
      }

      console.log(`📸 [Screenshot] Starting screenshot capture:`, { fullPage, quality, format });
      
      // Execute screenshot via context
      const result = await executeTool('screenshot', { fullPage, quality, format });
      
      if (result?.error) {
        throw new Error(result.error);
      }
      
      console.log(`✅ [Screenshot] Successfully captured screenshot:`, {
        format,
        fullPage,
        dataLength: result?.screenshot?.length || 0,
      });
      
      return {
        success: true,
        screenshot: result?.screenshot || '',
        fullPage,
        quality,
        format,
        timestamp: Date.now(),
        toolCallId,
      };
    } catch (error) {
      console.error(`❌ [Screenshot] Failed to capture screenshot:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown screenshot error',
        timestamp: Date.now(),
        toolCallId,
      };
    }
  },
  onInputStart: () => {
    console.log('🔍 [Screenshot] Starting to generate screenshot parameters...');
  },
  onInputDelta: ({ inputTextDelta }) => {
    console.log(`📝 [Screenshot] Received input chunk: "${inputTextDelta}"`);
  },
  onInputAvailable: ({ input }) => {
    console.log(`✅ [Screenshot] Complete screenshot input:`, input);
  },
});