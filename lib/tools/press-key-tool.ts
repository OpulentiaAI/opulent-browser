import { tool } from 'ai';
import { z } from 'zod';

/**
 * Enhanced Press Key Tool - AI SDK 2.0 compliant
 * Provides type-safe key pressing with comprehensive error handling
 */
export const pressKeyTool = (executeTool: (toolName: string, params: any) => Promise<any>) => tool({
  description: 'Press a single key on the keyboard with optional modifiers.',
  inputSchema: z.object({
    key: z.string().describe('Key to press (e.g., "Enter", "Escape", "Tab", "a", "1")'),
    modifiers: z.array(z.enum(['Ctrl', 'Alt', 'Shift', 'Meta'])).optional().default([]).describe('Modifier keys to hold while pressing'),
    element: z.string().optional().describe('CSS selector of element to focus before pressing key'),
    holdDuration: z.number().optional().default(50).describe('Duration to hold the key in milliseconds'),
  }),
  execute: async ({ 
    key, 
    modifiers = [], 
    element, 
    holdDuration = 50 
  }, { toolCallId, messages, abortSignal }) => {
    try {
      // Check for abort signal
      if (abortSignal?.aborted) {
        throw new Error('Press key operation aborted');
      }

      // Validate input
      if (!key) {
        throw new Error('Key is required for press key operation');
      }

      console.log(`⌨️ [PressKey] Starting key press:`, { key, modifiers, element, holdDuration });
      
      // Execute key press via context
      const result = await executeTool('pressKey', { 
        key, 
        modifiers, 
        element, 
        holdDuration 
      });
      
      if (result?.error) {
        throw new Error(result.error);
      }
      
      console.log(`✅ [PressKey] Successfully pressed key:`, result);
      
      return {
        success: true,
        keyPressed: key,
        modifiers,
        element: result?.element || element,
        holdDuration,
        timestamp: Date.now(),
        toolCallId,
      };
    } catch (error) {
      console.error(`❌ [PressKey] Failed to press key:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown press key error',
        key,
        timestamp: Date.now(),
        toolCallId,
      };
    }
  },
  onInputStart: () => {
    console.log('🔍 [PressKey] Starting to generate press key parameters...');
  },
  onInputDelta: ({ inputTextDelta }) => {
    console.log(`📝 [PressKey] Received input chunk: "${inputTextDelta}"`);
  },
  onInputAvailable: ({ input }) => {
    console.log(`✅ [PressKey] Complete press key input:`, input);
  },
});