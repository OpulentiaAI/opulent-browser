import { tool } from 'ai';
import { z } from 'zod';

/**
 * Enhanced Get Page Context Tool - AI SDK 2.0 compliant
 * Provides type-safe page context extraction with comprehensive error handling
 */
export const getPageContextTool = (executeTool: (toolName: string, params: any) => Promise<any>) => tool({
  description: 'Get the current page context including URL, title, text content, links, forms, and viewport information.',
  inputSchema: z.object({
    includeText: z.boolean().optional().default(true).describe('Include page text content'),
    includeLinks: z.boolean().optional().default(true).describe('Include page links'),
    includeForms: z.boolean().optional().default(true).describe('Include page forms'),
    maxTextLength: z.number().optional().default(10000).describe('Maximum text length to return'),
    waitForLoad: z.boolean().optional().default(true).describe('Wait for page to fully load before extracting context'),
  }),
  execute: async ({ 
    includeText = true, 
    includeLinks = true, 
    includeForms = true, 
    maxTextLength = 10000,
    waitForLoad = true 
  }, { toolCallId, messages, abortSignal }) => {
    try {
      // Check for abort signal
      if (abortSignal?.aborted) {
        throw new Error('Page context extraction aborted');
      }

      console.log(`📄 [PageContext] Starting context extraction:`, { 
        includeText, 
        includeLinks, 
        includeForms, 
        maxTextLength 
      });
      
      // Execute page context extraction via context
      const result = await executeTool('getPageContext', { 
        includeText, 
        includeLinks, 
        includeForms, 
        maxTextLength,
        waitForLoad 
      });
      
      if (result?.error) {
        throw new Error(result.error);
      }
      
      console.log(`✅ [PageContext] Successfully extracted context:`, {
        url: result?.url,
        textLength: result?.text?.length || 0,
        linksCount: result?.links?.length || 0,
        formsCount: result?.forms?.length || 0,
      });
      
      return {
        success: true,
        pageContext: result || {},
        extractionTime: result?.extractionTime || 0,
        timestamp: Date.now(),
        toolCallId,
      };
    } catch (error) {
      console.error(`❌ [PageContext] Failed to extract context:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown page context error',
        timestamp: Date.now(),
        toolCallId,
      };
    }
  },
  onInputStart: () => {
    console.log('🔍 [PageContext] Starting to generate page context parameters...');
  },
  onInputDelta: ({ inputTextDelta }) => {
    console.log(`📝 [PageContext] Received input chunk: "${inputTextDelta}"`);
  },
  onInputAvailable: ({ input }) => {
    console.log(`✅ [PageContext] Complete page context input:`, input);
  },
});