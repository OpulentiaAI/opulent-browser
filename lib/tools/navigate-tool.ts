import { tool } from 'ai';
import { z } from 'zod';

/**
 * Enhanced Navigate Tool - AI SDK 6 Beta compliant
 * Provides type-safe navigation with comprehensive error handling and approval workflow
 */
export const navigateTool = (executeTool: (toolName: string, params: any) => Promise<any>, allowedDomains: string[] = []) => tool({
  description: 'Navigate to a specific URL. Validates URL format and handles navigation errors.',
  inputSchema: z.object({
    url: z.string().url().describe('The URL to navigate to. Must be a valid HTTP/HTTPS URL.'),
    waitForLoad: z.boolean().optional().default(true).describe('Wait for page to fully load before returning'),
    timeout: z.number().optional().default(30000).describe('Navigation timeout in milliseconds'),
  }),
  // AI SDK 6 Beta: Approval for external domains
  needsApproval: async ({ url }) => {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      return !allowedDomains.includes(hostname);
    } catch {
      return true; // Require approval for invalid URLs
    }
  },
  execute: async ({ url, waitForLoad = true, timeout = 30000 }, { toolCallId, messages, abortSignal }) => {
    try {
      // Check for abort signal
      if (abortSignal?.aborted) {
        throw new Error('Navigation aborted');
      }

      console.log(`🧭 [Navigate] Starting navigation to: ${url}`);
      
      // Execute navigation via context
      const result = await executeTool('navigate', { url, waitForLoad, timeout });
      
      if (result?.error) {
        throw new Error(result.error);
      }
      
      console.log(`✅ [Navigate] Successfully navigated to: ${url}`);
      
      return {
        success: true,
        url: result?.finalUrl || url,
        title: result?.title || '',
        loadTime: result?.loadTime || 0,
        timestamp: Date.now(),
        toolCallId,
      };
    } catch (error) {
      console.error(`❌ [Navigate] Failed to navigate to ${url}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown navigation error',
        url,
        timestamp: Date.now(),
        toolCallId,
      };
    }
  },
  onInputStart: () => {
    console.log('🔍 [Navigate] Starting to generate navigation parameters...');
  },
  onInputDelta: ({ inputTextDelta }) => {
    console.log(`📝 [Navigate] Received input chunk: "${inputTextDelta}"`);
  },
  onInputAvailable: ({ input }) => {
    console.log(`✅ [Navigate] Complete navigation input:`, input);
  },
});