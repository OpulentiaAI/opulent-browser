/**
 * Centralized Browser Automation Tools - AI SDK 2.0 Compliant
 * 
 * This file exports all browser automation tools with proper typing,
 * inputSchema validation, and comprehensive error handling.
 * 
 * All tools follow AI SDK 2.0 patterns including:
 * - inputSchema instead of parameters
 * - Typed execute functions
 * - Lifecycle hooks (onInputStart, onInputDelta, onInputAvailable)
 * - Comprehensive error handling
 * - Tool call ID tracking
 * - Abort signal support
 */

export { navigateTool } from './navigate-tool';
export { clickTool } from './click-tool';
export { typeTool } from './type-tool';
export { getPageContextTool } from './get-page-context-tool';
export { screenshotTool } from './screenshot-tool';
export { scrollTool } from './scroll-tool';
export { waitTool } from './wait-tool';
export { pressKeyTool } from './press-key-tool';

/**
 * Complete browser automation tool set factory
 * Creates tools with proper execution context
 */
import { navigateTool } from './navigate-tool';
import { clickTool } from './click-tool';
import { typeTool } from './type-tool';
import { getPageContextTool } from './get-page-context-tool';
import { screenshotTool } from './screenshot-tool';
import { scrollTool } from './scroll-tool';
import { waitTool } from './wait-tool';
import { pressKeyTool } from './press-key-tool';

export const createBrowserAutomationTools = (executeTool: (toolName: string, params: any) => Promise<any>, allowedDomains: string[] = []) => {
  return {
    navigate: navigateTool(executeTool, allowedDomains),
    click: clickTool(executeTool),
    type: typeTool(executeTool),
    getPageContext: getPageContextTool(executeTool),
    screenshot: screenshotTool(executeTool),
    scroll: scrollTool(executeTool),
    wait: waitTool(executeTool),
    pressKey: pressKeyTool(executeTool),
  };
};

/**
 * Type definitions for tool parameters and results
 */
export type NavigateToolParams = Parameters<ReturnType<typeof navigateTool>['execute']>[0];
export type ClickToolParams = Parameters<ReturnType<typeof clickTool>['execute']>[0];
export type TypeToolParams = Parameters<ReturnType<typeof typeTool>['execute']>[0];
export type GetPageContextToolParams = Parameters<ReturnType<typeof getPageContextTool>['execute']>[0];

export type BrowserAutomationToolSet = ReturnType<typeof createBrowserAutomationTools>;