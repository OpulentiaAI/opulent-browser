import { useState, useEffect, useRef } from 'react';
// __name polyfill for AI SDK compatibility in browser environment
if (typeof globalThis !== 'undefined' && !globalThis.__name) {
  globalThis.__name = (target: any, name: string) => {
    Object.defineProperty(target, 'name', { value: name, configurable: true });
    return target;
  };
}

import { createRoot } from 'react-dom/client';
import { Streamdown } from 'streamdown';
import './app.css'; // Import GT America fonts and OKLCH theme
import type { Settings, MCPClient, PageContext, Message } from './types';
import { GeminiResponseSchema } from './types';
import { stepCountIs } from 'ai';
import { initializeBraintrust } from './lib/braintrust';
import { AIDevtools } from '@ai-sdk-tools/devtools';
import { Provider, useChatMessages, useChatActions, useChatStoreApi } from '@ai-sdk-tools/store';
import { StepDisplay } from './components/StepDisplay';
import { EnhancedStepDisplay } from './components/EnhancedStepDisplay';
import { ToolExecutionDisplay } from './components/ToolExecutionDisplay';
import { PlanningDisplay } from './components/PlanningDisplay';
import { Tool } from './components/ui/tool';
import { AgentComposerIntegration } from './components/agents-ui/agent-composer-integration';
import { ModelMorphDropdown } from './components/ai-elements/model-morph-dropdown';
import { ReasoningChatForm } from './components/reasoning-chat-form';
import { Reasoning, ReasoningTrigger, ReasoningContent } from './components/ai-elements/reasoning';
import { Response } from './components/ai-elements/response';
import { cn } from './lib/utils';
import { ApprovalModal, type ToolApprovalRequest } from './components/ui/approval-modal';
// Enhanced chat elements with improved styling
import { 
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from './components/ai-elements/conversation';
import { buildFinalSummaryMessage } from './lib/message-utils';
import {
  Message as MessageComponent,
  MessageContent,
} from './components/ai-elements/message';
import { EnhancedToolCallDisplay } from './components/ui/structured-output';
import { WorkflowTaskList } from './components/ui/workflow-task-list';
import { Button } from './components/ui/button';
import { Send } from 'lucide-react';
import { useStickToBottomContext } from 'use-stick-to-bottom';
import {
  PageContextArtifact,
  SummarizationArtifact,
  ErrorAnalysisArtifact,
  ExecutionTrajectoryArtifact,
  WorkflowMetadataArtifact,
} from './components/ui/artifact-views';

// Suppress noisy unhandled errors coming from provider fallbacks (e.g., AI_NoOutputGeneratedError)
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const reason: any = event?.reason;
    const message = typeof reason?.message === 'string' ? reason.message : String(reason || '');
    const name = typeof reason?.name === 'string' ? reason.name : '';
    if (name === 'AI_NoOutputGeneratedError' || /no output generated/i.test(message)) {
      console.warn('⚠️ [Fallback] Suppressed unhandled rejection:', message);
      event.preventDefault();
    }
  });

  window.addEventListener('error', (event) => {
    const name = event?.error?.name || '';
    const message = event?.message || '';
    if (name === 'AI_NoOutputGeneratedError' || /no output generated/i.test(message)) {
      console.warn('⚠️ [Fallback] Suppressed page error:', message);
      event.preventDefault();
    }
  });
}

// AI Elements Response primitive is used for message content display
// It uses Streamdown internally with proper memoization and streaming support

function ChatSidebar() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  
  // Approval flow state
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);
  const [currentApproval, setCurrentApproval] = useState<ToolApprovalRequest | null>(null);
  const [approvalResolver, setApprovalResolver] = useState<((approved: boolean) => void) | null>(null);
  
  // Use @ai-sdk-tools/store for high-performance message management
  // Store works with message-like structures - we'll use type assertion for compatibility
  const messages = (useChatMessages<any>() as Message[]) || [];
  const actions = useChatActions<any>();
  const { setMessages, pushMessage, replaceMessageById } = actions;
  const chatStoreApi = useChatStoreApi();
  
  // Helper function to update the last message (common pattern)
  const updateLastMessage = (updater: (msg: Message) => Message) => {
    const currentMessages = Array.isArray(messages) ? messages : [];
    if (currentMessages.length === 0) return;
    
    const lastMessage = currentMessages[currentMessages.length - 1];
    const updatedMessage = updater(lastMessage);
    replaceMessageById(lastMessage.id, updatedMessage);
  };

  // Approval handler that returns a Promise - this will pause execution until user responds
  const handleApprovalRequired = async (toolName: string, args: any): Promise<boolean> => {
    return new Promise((resolve) => {
      setCurrentApproval({
        toolCallId: `approval_${Date.now()}`,
        toolName,
        args,
        reason: `The AI agent wants to execute ${toolName} with the specified parameters.`,
        riskLevel: toolName === 'navigate' ? 'medium' : 'low',
      });
      setApprovalResolver(() => resolve);
      setApprovalModalOpen(true);
    });
  };

  const handleApprove = () => {
    if (approvalResolver) {
      approvalResolver(true);
      setApprovalResolver(null);
    }
    setApprovalModalOpen(false);
    setCurrentApproval(null);
  };

  const handleReject = () => {
    if (approvalResolver) {
      approvalResolver(false);
      setApprovalResolver(null);
    }
    setApprovalModalOpen(false);
    setCurrentApproval(null);
  };

  // Helper function to append text to last message
  const appendToLastMessage = (text: string) => {
    updateLastMessage((msg) => ({ ...msg, content: msg.content + text }));
  };
  
  const [isLoading, setIsLoading] = useState(false);
  // Browser tools are always enabled - hardcoded
  const browserToolsEnabled = true;
  const [showBrowserToolsWarning, setShowBrowserToolsWarning] = useState(true);
  // Autoscroll handled via StickToBottom context (see AutoStickWatcher below)
  const abortControllerRef = useRef<AbortController | null>(null);
  const mcpClientRef = useRef<MCPClient | null>(null);
  const mcpToolsRef = useRef<Record<string, unknown> | null>(null);
  const listenerAttachedRef = useRef(false);
  const settingsHashRef = useRef('');
  const mcpInitPromiseRef = useRef<Promise<void> | null>(null);
  const composioSessionRef = useRef<{ expiresAt: number } | null>(null);
  // Track the active browser tab id for metadata/tracking
  const browserTabIdRef = useRef<number | null>(null);
  const browserTabUrlRef = useRef<string | null>(null);

  // Initialize active tab id on mount
  useEffect(() => {
    try {
      chrome.runtime?.sendMessage({ type: 'GET_TAB_INFO' }, (info) => {
        if (info?.id) browserTabIdRef.current = info.id as number;
      });
    } catch (_) {
      // Ignore if not available
    }
  }, []);

  const executeTool = async (toolName: string, parameters: any, retryCount = 0): Promise<any> => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1500; // 1.5 seconds to allow page to load
    
    // Different timeouts for different tool types
    const TOOL_TIMEOUTS: Record<string, number> = {
      screenshot: 10000,
      navigate: 15000,
      click: 8000,
      type: 6000,
      scroll: 4000,
      getPageContext: 5000,
      getBrowserHistory: 8000,
      wait: 30000,
      pressKey: 3000,
      keyCombo: 3000,
      dragDrop: 10000,
    };

    const TOOL_TIMEOUT = TOOL_TIMEOUTS[toolName] || 8000;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    // Track tool execution start across try/catch
    const executionStartTime = Date.now();
    
    try {
      // Create a promise that rejects on timeout
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Tool ${toolName} timed out after ${TOOL_TIMEOUT}ms`));
        }, TOOL_TIMEOUT);
      });

      // Create a promise that resolves/rejects based on the actual tool execution
      const toolPromise = new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'EXECUTE_TOOL', toolName, parameters }, (response) => {
          const errorMsg = response?.error || chrome.runtime.lastError?.message || '';
          const isConnectionError = errorMsg.includes('Receiving end does not exist') || 
                                   errorMsg.includes('Could not establish connection');
          
          if (isConnectionError && retryCount < MAX_RETRIES) {
            console.log(`🔄 [executeTool] Connection error on ${toolName}, retrying... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            
            setTimeout(async () => {
              try {
                const result = await executeTool(toolName, parameters, retryCount + 1);
                resolve(result);
              } catch (error) {
                reject(error);
              }
            }, RETRY_DELAY);
          } else if (response?.error) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });

      // Race between tool execution and timeout
      const result = await Promise.race([toolPromise, timeoutPromise]) as any;
      
      // Clear timeout if successful
      clearTimeout(timeoutId);
      
      // Track execution duration and success
      const executionDuration = Date.now() - executionStartTime;
      trackToolExecution(toolName, parameters, 'output-available', result);
      
      console.log(`✅ [executeTool] ${toolName} completed in ${executionDuration}ms`);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown tool execution error';
      // Ensure timeout is cleared on failure as well
      if (timeoutId) clearTimeout(timeoutId);
      const executionDuration = Date.now() - executionStartTime;
      
      console.error(`❌ [executeTool] ${toolName} failed after ${executionDuration}ms:`, errorMessage);

      // Gracefully handle restricted pages (e.g., chrome:// URLs)
      if (errorMessage.includes('chrome://')) {
        console.warn(`⚠️ [executeTool] ${toolName} encountered restricted URL. Returning cached context.`);
        const fallbackResult = {
          success: true,
          url: browserTabUrlRef.current || '',
          pageContext: {
            url: browserTabUrlRef.current || '',
            title: '',
            textContent: '',
            links: [],
            images: [],
            forms: [],
            metadata: {},
            viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          },
          error: errorMessage,
        };
        trackToolExecution(toolName, parameters, 'output-available', fallbackResult);
        return fallbackResult;
      }

      // Retry logic for transient failures
      const transientErrors = [
        'timeout',
        'network error',
        'connection lost',
        'receiving end does not exist'
      ];
      
      const isTransientError = transientErrors.some(errorType => 
        errorMessage.toLowerCase().includes(errorType)
      );
      
      if (isTransientError && retryCount < MAX_RETRIES) {
        console.log(`🔄 [executeTool] Retrying ${toolName} due to transient error... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        
        setTimeout(async () => {
          try {
            const result = await executeTool(toolName, parameters, retryCount + 1);
            return result;
          } catch (retryError) {
            // Track final failure
            trackToolExecution(toolName, parameters, 'output-error', undefined, errorMessage);
            throw retryError;
          }
        }, RETRY_DELAY);
        
        return; // Don't throw here, let the retry handle it
      }
      
      // Final failure - track it
      trackToolExecution(toolName, parameters, 'output-error', undefined, errorMessage);
      throw error;
    }
  };

  /**
   * Enhanced tool tracking with metadata and deterministic structure
   */
  const trackToolExecution = (
    toolName: string, 
    input: any, 
    state: 'input-available' | 'output-available' | 'output-error',
    output?: any,
    errorText?: string
  ) => {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const execution = {
      toolCallId: executionId,
      toolName,
      state,
      input,
      output,
      errorText,
      timestamp: Date.now(),
      duration: Date.now() - (input?._startTime || Date.now()),
      metadata: {
        retryCount: input?._retryCount || 0,
        browserTabId: browserTabIdRef.current ?? undefined,
        url: browserTabUrlRef.current || undefined,
        ...input?._metadata
      }
    };

    // Update the last assistant message using replaceMessageById via helper
    updateLastMessage((msg) => {
      if (msg.role !== 'assistant') return msg;

      const updatedToolExecutions = [...(msg.toolExecutions || [])];
      const existingIndex = updatedToolExecutions.findIndex(exec => exec.toolCallId === executionId);
      if (existingIndex >= 0) {
        updatedToolExecutions[existingIndex] = execution;
      } else {
        updatedToolExecutions.push(execution);
      }

      return {
        ...msg,
        toolExecutions: updatedToolExecutions,
        metadata: {
          ...msg.metadata,
          lastToolUpdate: Date.now(),
        },
      } as Message;
    });

    console.log(`🔧 [trackToolExecution] ${toolName} (${state}):`, {
      executionId,
      duration: execution.duration,
      hasInput: !!input,
      hasOutput: !!output,
      hasError: !!errorText
    });
  };

  /**
   * Enhanced tool execution with comprehensive error handling and validation
   */
  const executeToolWithValidation = async (toolName: string, parameters: any): Promise<any> => {
    const startTime = Date.now();
    
    try {
      // Add execution metadata for tracking
      const enhancedParameters = {
        ...parameters,
        _startTime: startTime,
        _toolName: toolName,
        _retryCount: 0
      };

      const result = await executeTool(toolName, enhancedParameters);
      
      // Validate result structure
      if (!result || typeof result !== 'object') {
        throw new Error(`Tool ${toolName} returned invalid result structure`);
      }

      // Log successful execution
      const duration = Date.now() - startTime;
      console.log(`✅ [executeToolWithValidation] ${toolName} completed in ${duration}ms`);
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ [executeToolWithValidation] ${toolName} failed after ${duration}ms:`, error);
      throw error;
    }
  };

  /**
   * Create deterministic tool result with consistent structure
   */
  const createDeterministicToolResult = (
    toolName: string,
    success: boolean,
    data?: any,
    error?: string,
    metadata: Record<string, any> = {}
  ) => {
    return {
      success,
      data,
      error,
      timestamp: Date.now(),
      toolName,
      toolCallId: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      duration: Date.now() - (metadata.startTime || Date.now()),
      metadata: {
        ...metadata,
        deterministic: true,
        version: '1.0'
      }
    };
  };

  /**
   * Enhanced tool execution with preliminary results and streaming
   */
  const executeToolWithStreaming = async function* (toolName: string, parameters: any) {
    const startTime = Date.now();
    
    try {
      yield { type: 'status', stage: 'preparing', message: `Preparing ${toolName}...` };
      
      // Add execution metadata
      const enhancedParameters = {
        ...parameters,
        _startTime: startTime,
        _toolName: toolName,
        streaming: true
      };

      yield { type: 'status', stage: 'executing', message: `Executing ${toolName}...` };
      
      // Execute the tool
      const result = await executeToolWithValidation(toolName, enhancedParameters);
      
      yield { type: 'status', stage: 'completed', message: `${toolName} completed successfully` };
      yield { type: 'result', data: result, duration: Date.now() - startTime };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      yield { type: 'error', error: error instanceof Error ? error.message : 'Unknown error', duration };
    }
  };

  const loadSettings = async (forceRefresh = false) => {
    chrome.storage.local.get(['atlasSettings'], async (result) => {
      if (result.atlasSettings) {
        // MIGRATION: Force update to Google Gemini if using Anthropic models
        let migratedSettings = { ...result.atlasSettings };
        const needsMigration =
          migratedSettings.model?.includes('anthropic') ||
          migratedSettings.model?.includes('claude') ||
          migratedSettings.provider === 'google'; // Also migrate old Google Direct API users

        if (needsMigration) {
          console.log('🔄 [Migration] Updating to default model via gateway');
          console.log('   Old model:', migratedSettings.model);
          migratedSettings = {
            ...migratedSettings,
            provider: 'gateway',
            model: 'google/gemini-2.5-flash', // Keep user's choice or use good default
            computerUseEngine: 'gateway', // Use gateway engine (not flash-lite specific)
          };
          console.log('   New model:', migratedSettings.model);

          // Save migrated settings
          chrome.storage.local.set({ atlasSettings: migratedSettings });
        }

          console.log('🔑 Loaded settings:', JSON.stringify({
            provider: migratedSettings.provider,
            model: migratedSettings.model,
            hasApiKey: !!migratedSettings.apiKey,
            apiKeyLength: migratedSettings.apiKey?.length,
            apiKeyPrefix: migratedSettings.apiKey?.substring(0, 10) + '...'
          }, null, 2));
        setSettings(migratedSettings);

        // Initialize Braintrust if API key is provided
        if (migratedSettings.braintrustApiKey) {
          await initializeBraintrust(
            migratedSettings.braintrustApiKey,
            migratedSettings.braintrustProjectName || 'atlas-extension'
          );
          // Initialize wrapped AI SDK with Braintrust
          const { initializeWrappedAI } = await import('./lib/ai-wrapped');
          await initializeWrappedAI(migratedSettings.braintrustApiKey);
        } else {
          // Initialize without Braintrust
          const { initializeWrappedAI } = await import('./lib/ai-wrapped');
          await initializeWrappedAI();
        }

        const settingsHash = JSON.stringify(migratedSettings);
        const hasSettingsChanged = forceRefresh || settingsHash !== settingsHashRef.current;

        if (hasSettingsChanged && migratedSettings.composioApiKey) {
          settingsHashRef.current = settingsHash;

          try {
            const { initializeComposioToolRouter } = await import('./tools');
            const toolRouterSession = await initializeComposioToolRouter(
              migratedSettings.composioApiKey
            );

            composioSessionRef.current = { expiresAt: toolRouterSession.expiresAt };

            chrome.storage.local.set({
              composioSessionId: toolRouterSession.sessionId,
              composioChatMcpUrl: toolRouterSession.chatSessionMcpUrl,
              composioToolRouterMcpUrl: toolRouterSession.toolRouterMcpUrl,
            });
          } catch (error) {
            console.error('Failed to initialize Composio:', error);
          }
        }
      } else {
        setShowSettings(true);
      }
    });
  };

  useEffect(() => {
    // Load settings on mount
    loadSettings();

    // Attach settings update listener only once to prevent duplicates
    if (!listenerAttachedRef.current) {
      const handleMessage = (request: any) => {
        if (request.type === 'SETTINGS_UPDATED') {
          console.log('Settings updated, refreshing...');
          loadSettings(true); // Force refresh to reinitialize Braintrust
        }
      };

      chrome.runtime.onMessage.addListener(handleMessage);
      listenerAttachedRef.current = true;

      // Cleanup listener on unmount
      return () => {
        chrome.runtime.onMessage.removeListener(handleMessage);
        listenerAttachedRef.current = false;
      };
    }
  }, []);

  // AutoStickWatcher renders inside the StickToBottom context
  const AutoStickWatcher = ({ count, lastRole }: { count: number; lastRole?: string }) => {
    const { isAtBottom, scrollToBottom } = useStickToBottomContext();
    useEffect(() => {
      if (lastRole === 'user' || isAtBottom) {
        scrollToBottom();
      }
    }, [count]);
    return null;
  };

  const openSettings = () => {
    chrome.runtime.openOptionsPage();
  };

  const isComposioSessionExpired = (): boolean => {
    if (!composioSessionRef.current) return true;
    return Date.now() > composioSessionRef.current.expiresAt;
  };

  const ensureApiKey = (): string => {
    if (!settings?.apiKey) {
      throw new Error('Google API key not configured. Please add it in Settings.');
    }
    return settings.apiKey;
  };

  const ensureModel = (): string => {
    if (!settings?.model) {
      throw new Error('AI model not configured. Please select a model in Settings.');
    }
    return settings.model;
  };

  const getComputerUseEngine = () => {
    if (!settings) return 'gateway';
    return settings.computerUseEngine || (settings.provider === 'google' ? 'google' : 'gateway');
  };

  const getComputerUseLabel = () => {
    // Use the user's selected model when available, only fallback to defaults when no model is set
    if (settings?.model) {
      return settings.model;
    }

    const engine = getComputerUseEngine();
    return engine === 'google' ? 'gemini-2.5-computer-use-preview-10-2025' : 'google/gemini-2.5-flash-lite-preview-09-2025';
  };

  const toggleBrowserTools = async () => {
    // Browser tools are always enabled - this function is disabled
    if (!settings) {
      alert('⚠️ Please configure your settings first.');
      openSettings();
      return;
    }

    const engine = getComputerUseEngine();
    if (engine === 'google') {
      if (settings.provider !== 'google' || !settings.apiKey) {
        const confirmed = window.confirm(
          '🌐 Browser Tools (Google Computer Use) requires a Google API key.\n\nWould you like to open Settings to add your Google API key?'
        );
        if (confirmed) openSettings();
        return;
      }
    } else {
      // gateway-flash-lite
      if (settings.provider !== 'gateway' || !settings.apiKey) {
        const confirmed = window.confirm(
          '🌐 Browser Tools (AI Gateway Flash Lite) requires an AI Gateway API key.\n\nWould you like to open Settings to add your AI Gateway API key?'
        );
        if (confirmed) openSettings();
        return;
      }
    }

    // Clear MCP cache on initialization
    if (mcpClientRef.current) {
      try {
        await mcpClientRef.current.close();
      } catch (error) {
        console.error('Error closing MCP client:', error);
      }
    }
    mcpClientRef.current = null;
    mcpToolsRef.current = null;
    setShowBrowserToolsWarning(false);
  };

  const stop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  };

  const newChat = async () => {
    // Clear messages and tool executions
    setMessages([]);
    setShowBrowserToolsWarning(false);
    
    // Force close and clear ALL cached state
    if (mcpClientRef.current) {
      try {
        await mcpClientRef.current.close();
        console.log('Closed previous MCP client');
      } catch (error) {
        console.error('Error closing MCP client:', error);
      }
    }
    mcpClientRef.current = null;
    mcpToolsRef.current = null;
    
    
    // Reinitialize Composio session if API key present
    if (settings?.composioApiKey) {
      try {
        const { initializeComposioToolRouter } = await import('./tools');
        // Use unique, persistent user ID
        const toolRouterSession = await initializeComposioToolRouter(
          settings.composioApiKey
        );
        
        chrome.storage.local.set({ 
          composioSessionId: toolRouterSession.sessionId,
          composioChatMcpUrl: toolRouterSession.chatSessionMcpUrl || toolRouterSession.chatMcpUrl,
          composioToolRouterMcpUrl: toolRouterSession.toolRouterMcpUrl,
        });
        
        console.log('New Composio session created');
        console.log('Session ID:', toolRouterSession.sessionId);
      } catch (error) {
        console.error('Failed to create new Composio session:', error);
      }
    }
  };

  const streamWithGeminiComputerUse = async (messages: Message[]) => {
    // Wrap entire browser tools workflow in Braintrust trace
    const { traced } = await import('./lib/braintrust');
    return await traced(
      'browser_tools_workflow',
      async () => {
        try {
          const apiKey = ensureApiKey();

      // Add initial assistant message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
      };
      pushMessage(assistantMessage);

      // Get initial screenshot with retry logic
      let screenshot = await executeTool('screenshot', {});

      if (!screenshot?.screenshot) {
        const errorMsg = screenshot?.error || 'Unknown error capturing screenshot';
        console.error('❌ Screenshot failed. Full response:', JSON.stringify(screenshot, null, 2));
        throw new Error(`Failed to capture screenshot: ${errorMsg}`);
      }
      
      // Prepare conversation history
      const contents: any[] = [];
      
      // Add message history
      for (const msg of messages) {
        if (msg.role === 'user') {
          contents.push({
            role: 'user',
            parts: [{ text: msg.content }]
          });
        } else {
          contents.push({
            role: 'model',
            parts: [{ text: msg.content }]
          });
        }
      }
      
      if (screenshot && screenshot.screenshot) {
        const lastUserContent = contents[contents.length - 1];
        if (lastUserContent && lastUserContent.role === 'user') {
          lastUserContent.parts.push({
            inline_data: {
              mime_type: 'image/png',
              data: screenshot.screenshot.split(',')[1]
            }
          });
        }
      }

      // Run pre-search (You.com) to seed URLs if key is available
      let preSearchBlock = '';
      let evaluationBlock = '';
      try {
        const userQuery = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
        const youKey = settings?.youApiKey;
        if (youKey && userQuery) {
          // Wrap DeepSearch in Braintrust trace
          const { traced } = await import('./lib/braintrust');
          const result = await traced(
            'deepsearch_pre_seed',
            async () => {
              const { runDeepSearch } = await import('./deepsearch');
              return await runDeepSearch(userQuery, { youApiKey: youKey });
            },
            { query: userQuery }
          );
          
          if (result.items?.length) {
            const lines = result.items.slice(0, 10).map((i, idx) => `  ${idx + 1}. ${i.title || i.url}\n     ${i.url}`);
            preSearchBlock = [
              'Pre-seeded sources (You Search):',
              ...lines,
              '',
              result.plan,
            ].join('\n');

            // Evaluator workflow: assess completeness + optimized query
            // This is already wrapped via wrapped AI SDK in evaluator.ts
            try {
              const { evaluateYouResults } = await import('./evaluator');
              const evalRes = await evaluateYouResults(
                userQuery,
                result.items.slice(0, 8),
                {
                  provider: (settings?.provider === 'gateway') ? 'gateway' : 'google',
                  apiKey: settings!.apiKey,
                  model: settings?.provider === 'google' ? 'gemini-2.5-flash' : undefined,
                  braintrustApiKey: settings?.braintrustApiKey,
                }
              );
              evaluationBlock = [
                'Evaluator:',
                `- Completeness: ${Math.round((evalRes.completeness || 0) * 100)}%`,
                evalRes.gaps?.length ? `- Gaps: ${evalRes.gaps.join('; ')}` : '- Gaps: none detected',
                `- Optimized query: ${evalRes.optimized_query}`,
                (evalRes.additional_queries && evalRes.additional_queries.length) ? `- Additional: ${evalRes.additional_queries.join(' | ')}` : '',
              ].filter(Boolean).join('\n');
            } catch (e) {
              console.warn('Evaluator workflow failed:', e);
            }
          }
        }
      } catch (e) {
        console.warn('You Search pre-seed failed (continuing without it):', e);
      }

      let responseText = '';
      const maxTurns = 30;
      const execSteps: Array<{ step: number; action: string; url?: string; success: boolean }> = [];

      // GEPA-optimized system prompt: enhanced through AI-powered evolutionary optimization
      // Run ID: run-1761861321816
      const systemInstruction = `You are a browser automation assistant with browser-only capabilities.

You MUST use the provided browser tools exactly as documented. Never invent new functions or call arbitrary code helpers.

AVAILABLE ACTIONS (computer_use tool interface):
- navigate({ url: string }) — open a URL (must include protocol like https://)
- getPageContext() — retrieve the latest DOM summary before acting (no parameters needed)
- click({ selector?: string, x?: number, y?: number }) — click element by CSS selector OR coordinates (provide one or the other)
- type_text({ selector?: string, text: string, press_enter?: boolean }) — type text into input by selector or focused element
- scroll({ direction?: "up"|"down"|"top"|"bottom", amount?: number, selector?: string }) — scroll page or element
- wait({ seconds: number }) — pause for specified seconds (max 60)
- press_key({ key: string }) — press single key like "Enter", "Tab", "Escape"
- key_combination({ keys: string[] }) — press key combination like ["Control", "A"]

CORE LOOP — **THINK → ACT → VERIFY**
1. THINK: State the immediate objective. Inspect page context to locate real selectors, URLs, or element labels. If you lack context, call getPageContext first.
2. ACT: Choose the correct tool with all required parameters. Prefer selectors from context; if using coordinates, explain why.
3. VERIFY: After each action, wait if needed, then confirm the result via getPageContext or visible page changes. If the result is unexpected, adjust plan or parameters.

MANDATORY PRACTICES
- Before interacting with new elements, gather fresh context (getPageContext).
- Never guess selectors—use the ones provided in context responses.
- After navigate, wait at least 2.5 seconds before issuing the next command.
- When typing, click/focus first if necessary, then type_text, and optionally press Enter.
- Execute one tool call per step, then verify success.
- On failure, explain the issue, adjust (scroll, wait, new selector), and retry or escalate to the user.

${preSearchBlock ? preSearchBlock + '\n' : ''}${evaluationBlock ? evaluationBlock + '\n' : ''}`;

      for (let turn = 0; turn < maxTurns; turn++) {
        if (abortControllerRef.current?.signal.aborted) {
          updateLastMessage((msg) => ({
            ...msg,
            content: msg.role === 'assistant' ? msg.content + '\n\n🛑 **Stopped by user**' : msg.content
          }));
          return; // Exit the agent loop
        }

        console.log(`\n--- Turn ${turn + 1}/${maxTurns} ---`);

        const requestBody = {
          contents,
          tools: [{
            computer_use: {
              environment: 'ENVIRONMENT_BROWSER'
            }
          }],
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          },
          generationConfig: {
            temperature: 1.0,
          },
          safetySettings: [
            {
              category: 'HARM_CATEGORY_HARASSMENT',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_HATE_SPEECH',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
              threshold: 'BLOCK_NONE'
            },
            {
              category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
              threshold: 'BLOCK_NONE'
            }
          ]
        };
        
        // Create abort controller with timeout
        const abortController = new AbortController();
        const executionTimeoutId = setTimeout(() => abortController.abort(), 60000); // 60 second timeout
        
        // Always use computer-use model for browser tools
        const computerUseModel = 'gemini-2.5-computer-use-preview-10-2025';

        let response;
        try {
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${computerUseModel}:generateContent?key=${apiKey}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(requestBody),
              signal: abortController.signal,
            }
          );
        } finally {
          clearTimeout(timeoutId);
        }
        
        if (!response.ok) {
          let errorDetails;
          try {
            errorDetails = await response.json();
            console.error('❌ Gemini API Error Response:', JSON.stringify(errorDetails, null, 2));
          } catch (e) {
            console.error('❌ Failed to parse error response:', e);
            errorDetails = { statusText: response.statusText };
          }

          const errorMessage = errorDetails?.error?.message || `API request failed with status ${response.status}: ${response.statusText}`;
          console.error('❌ Full error details:', errorDetails);

          throw new Error(errorMessage);
        }
        
        const data = await response.json();

        // Validate response structure with Zod
        let validatedData;
        try {
          validatedData = GeminiResponseSchema.parse(data);
        } catch (validationError) {
          console.error('❌ Gemini API response failed validation:', validationError);
          throw new Error(`Invalid Gemini API response format: ${(validationError as any).message}`);
        }

        // Check for safety blocks and prompt feedback
        if (validatedData.promptFeedback?.blockReason) {
          const blockReason = validatedData.promptFeedback.blockReason;
          console.error('🚫 Request blocked by safety filter:', blockReason);

          // Show detailed error to user
          updateLastMessage((msg) => ({
            ...msg,
            content: msg.role === 'assistant' 
              ? `⚠️ **Safety Filter Blocked Request**\n\nReason: ${blockReason}\n\nThis request was blocked by Gemini's safety filters. Try:\n- Using a different webpage\n- Simplifying your request\n- Avoiding sensitive actions\n\nFull response:\n\`\`\`json\n${JSON.stringify(validatedData, null, 2)}\n\`\`\``
              : msg.content
          }));
          return; // Exit the loop
        }

        const candidate = validatedData.candidates?.[0];

        if (!candidate) {
          console.error('❌ No candidate in response. Full response:', JSON.stringify(data, null, 2));
          throw new Error(`No candidate in Gemini response. Finish reason: ${data.candidates?.[0]?.finishReason || 'unknown'}. Full response: ${JSON.stringify(data)}`);
        }

        // Check if candidate has safety response requiring confirmation
        const safetyResponse = candidate.safetyResponse;
        if (safetyResponse?.requireConfirmation) {
          // Show confirmation dialog to user
          const confirmMessage = safetyResponse.message || 'This action requires confirmation. Do you want to proceed?';
          const userConfirmed = window.confirm(`🔒 Human Confirmation Required\n\n${confirmMessage}\n\nProceed with this action?`);

          if (!userConfirmed) {
            appendToLastMessage('\n\n❌ Action cancelled by user.');
            return; // Exit the loop
          }

          // Add confirmation to conversation
          contents.push({
            role: 'user',
            parts: [{ text: 'CONFIRMED: User approved this action. Please proceed.' }]
          });

          // Continue to next iteration to re-run with confirmation
          continue;
        }

        // Add model response to conversation
        contents.push(candidate.content);

        // Check if there are function calls
        const parts = candidate.content?.parts || [];
        const hasFunctionCalls = parts.some((p: any) => 'functionCall' in p && p.functionCall);

        if (!hasFunctionCalls) {
          // No more actions - task complete
          for (const part of parts) {
            if ('text' in part && typeof part.text === 'string') {
              responseText += part.text;
            }
          }
          break;
        }

        // Execute function calls
        const functionResponses: any[] = [];

        for (const part of parts) {
          if ('text' in part && typeof part.text === 'string') {
            responseText += part.text + '\n';
          } else if ('functionCall' in part && part.functionCall) {
            // Check if user clicked stop button
            if (abortControllerRef.current?.signal.aborted) {
              updateLastMessage((msg) => ({
                ...msg,
                content: msg.role === 'assistant' ? responseText + '\n\n🛑 **Stopped by user**' : msg.content
              }));
              return; // Exit the agent loop
            }

            const funcName = part.functionCall.name;
            const funcArgs = part.functionCall.args || {};

            responseText += `\n[Executing: ${funcName}]\n`;

            // Execute the browser action
            const result = await executeBrowserAction(funcName, funcArgs);
            
            // Wait longer after navigation actions for page to load
            const isNavigationAction = ['navigate', 'open_web_browser', 'navigate_to', 'go_to', 'click', 'click_at', 'mouse_click', 'go_back', 'back', 'go_forward', 'forward'].includes(funcName);
            if (isNavigationAction) {
              await new Promise(resolve => setTimeout(resolve, 2500)); // Wait 2.5 seconds for page to load
            } else {
              await new Promise(resolve => setTimeout(resolve, 500)); // Normal wait
            }
            
            screenshot = await executeTool('screenshot', {});
            
            if (!screenshot || !screenshot.screenshot) {
              console.warn('Failed to capture screenshot after action');
              screenshot = { screenshot: '' }; // Continue without screenshot
            }
            
            // Get current page URL and viewport dimensions (required by Gemini)
            let currentUrl = '';
            let viewportInfo = '';
            try {
              const pageInfo = await executeTool('getPageContext', {});
              currentUrl = pageInfo?.url || '';
              
              // Track execution step for Braintrust and summarization
              execSteps.push({
                step: execSteps.length + 1,
                action: funcName,
                url: currentUrl,
                success: result.success !== false,
              });

              // Include viewport dimensions to help Gemini understand coordinate space
              if (pageInfo?.viewport) {
                viewportInfo = ` Viewport: ${pageInfo.viewport.width}x${pageInfo.viewport.height}`;
              }
            } catch (error) {
              console.warn('Failed to get page URL:', error);
            }

            // Build function response with URL and viewport info (required by Gemini)
            const functionResponse: any = {
              name: funcName,
              response: {
                ...result,
                url: currentUrl,  // Gemini requires this
                viewport_info: viewportInfo,
                success: result.success !== false
              }
            };
            
            functionResponses.push(functionResponse);
            
            // Update UI
            updateLastMessage((msg) => ({
              ...msg,
              content: msg.role === 'assistant' ? responseText : msg.content
            }));
          }
        }
        
        // Add function responses back to conversation with new screenshot
        if (functionResponses.length > 0) {
          const userParts: any[] = functionResponses.map(fr => ({
            function_response: fr
          }));
          
          // Add new screenshot
          if (screenshot && screenshot.screenshot) {
            userParts.push({
              inline_data: {
                mime_type: 'image/png',
                data: screenshot.screenshot.split(',')[1]
              }
            });
          }
          
          contents.push({
            role: 'user',
            parts: userParts
          });
        }
      }
      
      // Final update
      updateLastMessage((msg) => ({
        ...msg,
        content: msg.role === 'assistant' ? (responseText || 'Task completed') : msg.content
      }));

      // Post-run summarization with You Advanced Agent (if token available)
      // Wrap in Braintrust trace to capture the summarization step
      try {
        const youToken = settings?.youApiKey;
        if (youToken) {
          const { traced } = await import('./lib/braintrust');
          const objective = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
          const trajectory = execSteps.slice(-50).map(s => `- step ${s.step}: ${s.action}${s.url ? ` @ ${s.url}` : ''} ${s.success ? '(ok)' : '(failed)'}`).join('\n') || '- (no actions executed)';
          const outcome = (responseText || '').slice(0, 1500);
          const prompt = [
            'Summarize the execution and propose next actions.',
            '',
            'Objective:',
            objective,
            '',
            'Execution Trajectory:',
            trajectory,
            '',
            'Outcome (assistant text):',
            outcome,
            '',
            'Your task: Summarize the execution trajectory, assess whether the objective was achieved and why, then propose exactly three high-impact next actions tailored to this context (include a short rationale and the recommended browser action or tool to execute). Return concise Markdown with sections: Summary, Goal assessment, Suggested next actions (1-3).'
          ].join('\n');
          
          const agentText = await traced(
            'you_advanced_agent_summarization',
            async () => {
              const { runYouAdvancedAgentSummary } = await import('./youAgent');
              return await runYouAdvancedAgentSummary(youToken, prompt, { verbosity: 'medium', maxWorkflowSteps: 5 });
            },
            {
              workflow_type: 'post_run_summarization',
              objective_length: objective.length,
              trajectory_steps: execSteps.length,
            }
          );
          
          pushMessage({ id: (Date.now() + 2).toString(), role: 'assistant', content: `---\nSummary & Next Steps (You Agent)\n\n${agentText}` });
        }
      } catch (e) {
        console.warn('You Advanced Agent summarizer failed:', e);
      }
      
      } catch (error: any) {
        console.error('❌ Error with Gemini Computer Use:');
        console.error('Error name:', error?.name);
        console.error('Error message:', error?.message);
        console.error('Error stack:', error?.stack);
        console.error('Full error object:', error);
        throw error;
      }
    },
    {
      workflow_type: 'browser_tools',
      initial_message: messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '',
    }
    );
  };

  // Scale coordinates from Gemini's 1000x1000 grid to actual viewport
  const scaleCoordinates = async (x: number, y: number) => {
    try {
      // Get actual viewport dimensions
      const pageInfo = await executeTool('getPageContext', {});
      const viewportWidth = pageInfo?.viewport?.width || 1440;
      const viewportHeight = pageInfo?.viewport?.height || 900;

      // Gemini uses 1000x1000 normalized coordinates
      const scaledX = Math.round((x / 1000) * viewportWidth);
      const scaledY = Math.round((y / 1000) * viewportHeight);
      return { x: scaledX, y: scaledY };
    } catch (error) {
      console.error('Failed to scale coordinates:', error);
      // Fallback to original coordinates if scaling fails
      return { x, y };
    }
  };

  const requiresUserConfirmation = async (functionName: string, args: any): Promise<boolean> => {
    let pageContext: any = {};
    try {
      pageContext = await executeTool('getPageContext', {});
    } catch (e) {
      console.warn('Could not get page context');
    }

    const url = pageContext?.url?.toLowerCase() || '';
    const pageText = pageContext?.text?.toLowerCase() || '';

    const alwaysConfirm = ['key_combination'];

    const isSensitivePage =
      url.includes('checkout') ||
      url.includes('payment') ||
      url.includes('login') ||
      url.includes('signin') ||
      url.includes('admin') ||
      url.includes('delete') ||
      url.includes('remove') ||
      pageText.includes('checkout') ||
      pageText.includes('payment') ||
      pageText.includes('purchase') ||
      pageText.includes('confirm order') ||
      pageText.includes('delete') ||
      pageText.includes('remove account');

    const isSensitiveInput = functionName.includes('type') && (
      args.text?.toLowerCase().includes('password') ||
      args.text?.match(/\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/) ||
      pageText.includes('credit card') ||
      pageText.includes('cvv') ||
      pageText.includes('social security')
    );

    const isFormSubmission = functionName === 'type_text_at' && args.press_enter === true;

    if (alwaysConfirm.includes(functionName) || isSensitivePage || isSensitiveInput || isFormSubmission) {
      const confirmMessage = `🔒 Confirm Action\n\nAction: ${functionName}\nPage: ${url}` +
        `${isSensitivePage ? '\n⚠️ Sensitive page' : ''}` +
        `${isSensitiveInput ? '\n⚠️ Sensitive data' : ''}` +
        `${isFormSubmission ? '\n⚠️ Form submission' : ''}\n\nProceed?`;
      return window.confirm(confirmMessage);
    }

    return false;
  };

  const executeBrowserAction = async (functionName: string, args: any) => {
    const userConfirmed = await requiresUserConfirmation(functionName, args);

    if (!userConfirmed && (
      ['key_combination'].includes(functionName) ||
      functionName.includes('type') ||
      functionName === 'type_text_at'
    )) {
      return { success: false, error: 'Action cancelled by user', userCancelled: true };
    }

    switch (functionName) {
      case 'click':
      case 'click_at':
      case 'mouse_click':
        // Scale coordinates from Gemini's 1000x1000 grid to actual viewport
        const clickCoords = await scaleCoordinates(
          args.x || args.coordinate?.x || 0,
          args.y || args.coordinate?.y || 0
        );
        return await executeTool('click', clickCoords);
      
      case 'type':
      case 'type_text':
      case 'keyboard_input':
      case 'input_text':
        return await executeTool('type', { 
          selector: 'input:focus, textarea:focus, [contenteditable="true"]:focus', 
          text: args.text || args.input || args.content
        });
      
      case 'scroll':
      case 'scroll_down':
      case 'scroll_up':
      case 'mouse_scroll':
        const direction = functionName === 'scroll_up' ? 'up' : 
                         functionName === 'scroll_down' ? 'down' : 
                         args.direction || 'down';
        return await executeTool('scroll', { 
          direction,
          amount: args.amount || args.pixels || args.delta || 500
        });
      
      case 'navigate':
      case 'open_web_browser':
      case 'navigate_to':
      case 'go_to':
        return await executeTool('navigate', { 
          url: args.url || args.address || args.uri
        });
      
      case 'get_screenshot':
      case 'take_screenshot':
      case 'screenshot':
        return await executeTool('screenshot', {});
      
      case 'get_page_info':
      case 'get_url':
      case 'get_page_content':
        return await executeTool('getPageContext', {});
      
      case 'wait':
      case 'sleep':
      case 'delay':
        const waitTime = (args.seconds || args.milliseconds / 1000 || 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return { success: true, message: `Waited ${waitTime}ms` };
      
      case 'press_key':
      case 'key_press':
        // Handle special keys like Enter, Tab, etc.
        return await executeTool('type', { 
          selector: 'input:focus, textarea:focus, [contenteditable="true"]:focus', 
          text: args.key || args.keyCode
        });
      
      case 'type_text_at':
        // Type text at coordinates (click first, then type)
        // This mimics Python's playwright keyboard.type() behavior
        if (args.x !== undefined && args.y !== undefined) {
          // Scale coordinates before clicking
          const typeCoords = await scaleCoordinates(args.x, args.y);
          await executeTool('click', typeCoords);
          // Wait for element to focus
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Clear existing text if requested
        if (args.clear_before_typing !== false) {
          // Use keyboard shortcuts to select all and delete (like Python implementation)
          const isMac = navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
          if (isMac) {
            await executeTool('keyCombo', { keys: ['Meta', 'a'] });
          } else {
            await executeTool('keyCombo', { keys: ['Control', 'a'] });
          }
          await new Promise(resolve => setTimeout(resolve, 50));
          await executeTool('pressKey', { key: 'Delete' });
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Use keyboard_type action which simulates actual keyboard typing
        const typeResult = await new Promise<any>((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: 'EXECUTE_ACTION',
              action: 'keyboard_type',
              value: args.text || args.content
            },
            (response) => {
              resolve(response);
            }
          );
        });

        // If press_enter is requested, send Enter key
        if (args.press_enter) {
          await new Promise(resolve => setTimeout(resolve, 100));
          await executeTool('pressKey', { key: 'Enter' });
        }

        return typeResult;
      
      case 'key_combination':
        // Press keyboard key combinations like ["Control", "A"] or ["Enter"]
        const keys = args.keys || [args.key] || ['Enter'];
        return await executeTool('keyCombo', { keys });
      
      case 'hover_at':
        // Hover mouse at coordinates
        const hoverCoords = await scaleCoordinates(args.x || 0, args.y || 0);
        return await executeTool('hover', hoverCoords);
      
      case 'scroll_document':
        // Scroll the entire page
        const scrollDir = args.direction || 'down';
        return await executeTool('scroll', { direction: scrollDir, amount: 800 });
      
      case 'scroll_at':
        // Scroll at specific coordinates
        return await executeTool('scroll', { 
          direction: args.direction || 'down', 
          amount: args.magnitude || 800 
        });
      
      case 'wait_5_seconds':
        await new Promise(resolve => setTimeout(resolve, 5000));
        return { success: true, message: 'Waited 5 seconds' };
      
      case 'go_back':
      case 'back':
        // Go back in browser history - properly async
        return new Promise<any>((resolve) => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
              chrome.tabs.goBack(tabs[0].id);
              // Add small delay for navigation to register
              setTimeout(() => {
                resolve({ success: true, message: 'Navigated back' });
              }, 300);
            } else {
              resolve({ success: false, error: 'No active tab found' });
            }
          });
        });

      case 'go_forward':
      case 'forward':
        // Go forward in browser history - properly async
        return new Promise<any>((resolve) => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
              chrome.tabs.goForward(tabs[0].id);
              // Add small delay for navigation to register
              setTimeout(() => {
                resolve({ success: true, message: 'Navigated forward' });
              }, 300);
            } else {
              resolve({ success: false, error: 'No active tab found' });
            }
          });
        });
      
      case 'search':
        // Navigate to Google search
        return await executeTool('navigate', { url: 'https://www.google.com' });
      
      case 'drag_and_drop':
        return await executeTool('dragDrop', { 
          x: args.x, 
          y: args.y, 
          destination_x: args.destination_x, 
          destination_y: args.destination_y 
        });
      
      default:
        console.warn('⚠️ Unknown Gemini function:', functionName, args);
        return { success: false, error: `Unknown function: ${functionName}`, args };
    }
  };

  // Stream with AI SDK using MCP tools
  const streamWithAISDKAndMCP = async (messages: Message[], tools: any) => {
    try {
      // Import streamText and provider SDKs - use wrapped AI SDK for Braintrust tracing
      const { getWrappedAI } = await import('./lib/ai-wrapped');
      const aiModule = await getWrappedAI(settings?.braintrustApiKey);
      const { streamText } = aiModule;
      const { z } = await import('zod');

      // Import the appropriate provider SDK based on settings
      let model;
      if (settings!.provider === 'gateway') {
        if (!settings?.apiKey) {
          throw new Error('AI Gateway API key is required. Please set it in settings.');
        }
        console.log('🔑 [streamWithAISDKAndMCP] Creating AI Gateway client with key:', settings.apiKey.substring(0, 10) + '...');
        const { createGateway } = await import('@ai-sdk/gateway');
        const gatewayClient = createGateway({ apiKey: settings.apiKey });
        model = gatewayClient(settings.model);
        console.log('✅ [streamWithAISDKAndMCP] AI Gateway client created for model:', settings.model);
      } else if (settings!.provider === 'openrouter') {
        if (!settings?.apiKey) {
          throw new Error('OpenRouter API key is required. Please set it in settings.');
        }
        console.log('🔑 [streamWithAISDKAndMCP] Creating OpenRouter client with key:', settings.apiKey.substring(0, 10) + '...');
        const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
        const openRouterClient = createOpenRouter({
          apiKey: settings.apiKey,
          headers: {
            'HTTP-Referer': chrome.runtime.getURL(''),
            'X-Title': 'Opulent Browser',
          },
        });
        model = openRouterClient.chat(settings.model);
        console.log('✅ [streamWithAISDKAndMCP] OpenRouter client created for model:', settings.model);
      } else if (settings!.provider === 'nim') {
        if (!settings?.apiKey) {
          throw new Error('NVIDIA NIM API key is required. Please set it in settings.');
        }
        console.log('🔑 [streamWithAISDKAndMCP] Creating NVIDIA NIM client with key:', settings.apiKey.substring(0, 10) + '...');
        const { createOpenAI } = await import('@ai-sdk/openai');
        const nimClient = createOpenAI({
          apiKey: settings.apiKey,
          baseURL: 'https://integrate.api.nvidia.com/v1',
        });
        model = nimClient(settings.model);
        console.log('✅ [streamWithAISDKAndMCP] NVIDIA NIM client created for model:', settings.model);
      } else {
        if (!settings?.apiKey) {
          throw new Error('Google API key is required. Please set it in settings.');
        }
        console.log('🔑 [streamWithAISDKAndMCP] Creating Google AI client with key:', settings.apiKey.substring(0, 10) + '...');
        const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
        const googleClient = createGoogleGenerativeAI({ apiKey: settings.apiKey });
        model = googleClient(settings.model);
        console.log('✅ [streamWithAISDKAndMCP] Google AI client created for model:', settings.model);
      }

      // Convert messages to AI SDK format
      const aiMessages = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      // Define browser history tool
      const browserHistoryTool = {
        getBrowserHistory: {
          description: 'Get browser history. Useful for finding recently visited pages.',
          parameters: z.object({
            query: z.string().optional().describe('Search term to filter history (e.g., "github", "reddit")'),
            maxResults: z.number().optional().describe('Maximum number of results (default: 20)'),
            daysBack: z.number().optional().describe('How many days back to search (default: 7)'),
          }),
          execute: async ({ query = '', maxResults = 20, daysBack = 7 }: { query?: string; maxResults?: number; daysBack?: number }) => {
            const startTime = Date.now() - (daysBack * 24 * 60 * 60 * 1000);
            const result = await executeTool('getBrowserHistory', { query, maxResults, startTime });
            
            // Format the history results for better readability
            if (result && result.history && Array.isArray(result.history)) {
              const formatted = result.history.map((item: any) => {
                const lastVisit = item.lastVisitTime ? new Date(item.lastVisitTime).toLocaleString() : 'Unknown';
                return `• **${item.title || 'Untitled'}**\n  ${item.url}\n  Last visited: ${lastVisit}`;
              }).join('\n\n');
              
              return `Found ${result.history.length} recent pages:\n\n${formatted}`;
            }
            
            return result;
          },
        },
      };

      // Merge MCP tools with browser history tool
      const allTools = {
        ...tools,
        ...browserHistoryTool,
      };

      const result = streamText({
        model,
        tools: allTools,
        messages: aiMessages,
        maxSteps: 15, // Hard limit on tool calls to prevent infinite loops
        maxTokens: 4000, // Reasonable token limit
        abortSignal: abortControllerRef.current?.signal,
      });
    
      // Add initial assistant message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
      };
      pushMessage(assistantMessage);

      // Stream the response - collect full text without duplicates
      let fullText = '';
      for await (const chunk of result.textStream) {
        fullText += chunk;
        updateLastMessage((msg) => ({
          ...msg,
          content: msg.role === 'assistant' ? fullText : msg.content
        }));
      }

    } catch (error) {
      console.error('❌ Error streaming with AI SDK:', error);
      throw error;
    }
  };

  // Computer Use via AI Gateway (Flash Lite) with Workflow-based orchestration
  const streamWithGatewayComputerUse = async (messages: Message[]) => {
    const { traced } = await import('./lib/braintrust');
    return await traced(
      'browser_tools_workflow_gateway',
      async () => {
        const userQuery = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
        
        // Log model being used (Anthropic models now supported with Bedrock-compatible schemas)
        const isAnthropicModel = settings?.model?.includes('anthropic') || settings?.model?.includes('claude');
        if (isAnthropicModel) {
          console.log('✅ [Gateway Computer Use] Using Anthropic model with Bedrock-compatible tool schemas');
        }
        
        console.log('🚀 [Gateway Computer Use] Starting browser automation workflow');
        console.log('🚀 [Gateway Computer Use] User query:', userQuery.substring(0, 100));
        console.log('🚀 [Gateway Computer Use] Settings:', JSON.stringify({
          provider: settings?.provider,
          model: settings?.model,
          hasBraintrust: !!settings?.braintrustApiKey,
          hasYouApi: !!settings?.youApiKey,
        }, null, 2));
        
        // Helper to query active tab info
        const getActiveTabInfo = async (): Promise<{ id?: number; url?: string }> => {
          return new Promise((resolve) => {
            try {
              chrome.runtime?.sendMessage({ type: 'GET_TAB_INFO' }, (info) => {
                resolve(info || {});
              });
            } catch (error) {
              resolve({});
            }
          });
        };

        // Get initial page context
        let initialPageContext: any = null;
        let currentUrl = browserTabUrlRef.current || '';
        try {
          const tabInfo = await getActiveTabInfo();
          if (tabInfo?.id) browserTabIdRef.current = tabInfo.id as number;
          if (tabInfo?.url) {
            browserTabUrlRef.current = tabInfo.url;
            currentUrl = tabInfo.url;
          }

          const isRestricted = tabInfo?.url?.startsWith('chrome://');
          if (isRestricted) {
            console.warn('⚠️ Skipping initial page context (restricted URL):', tabInfo?.url);
          } else {
            initialPageContext = await executeTool('getPageContext', {});
            currentUrl = initialPageContext?.url || currentUrl;
            browserTabUrlRef.current = currentUrl || browserTabUrlRef.current;
            console.log('🌐 [Gateway Computer Use] Initial page context retrieved, URL:', currentUrl);
          }
        } catch (e) {
          console.warn('⚠️ Could not get initial page context:', e);
        }
        
        // Helper functions for workflow context
        const getPageContextAfterAction = async (): Promise<PageContext> => {
          try {
            const ctx = await executeTool('getPageContext', {});
            if (ctx?.url) {
              currentUrl = ctx.url;
              browserTabUrlRef.current = ctx.url;
            }
            return {
              url: ctx?.url || currentUrl || '',
              title: ctx?.title || '',
              textContent: ctx?.text || ctx?.textContent || '',
              links: ctx?.links || [],
              images: ctx?.images || [],
              forms: ctx?.forms || [],
              metadata: ctx?.metadata || {},
              viewport: ctx?.viewport || { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            };
          } catch (e) {
            console.warn('Failed to get page context after action:', e);
            return { 
              url: currentUrl || browserTabUrlRef.current || '', 
              title: '', 
              textContent: '', 
              links: [], 
              images: [],
              forms: [], 
              metadata: {},
              viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 } 
            };
          }
        };
        
        const enrichToolResponseForWorkflow = async (res: any, toolName: string) => {
          try {
            // For very fast navigations, add a small delay before reading context
            if (toolName === 'navigate') {
              await new Promise(resolve => setTimeout(resolve, 400));
            }
            const pageCtx = await getPageContextAfterAction();
            return {
              success: res?.success !== false,
              url: pageCtx.url || res?.url || currentUrl,
              pageContext: pageCtx,
            };
          } catch (e) {
            return { success: res?.success !== false, url: res?.url || currentUrl };
          }
        };
        
        // Validate settings
        if (!settings?.apiKey) {
          throw new Error('API key is required');
        }
        
        // Prepare workflow input
        const workflowInput = {
          userQuery,
          settings: {
            provider: settings.provider || 'gateway',
            apiKey: settings.apiKey,
            model: settings.model || 'google/gemini-2.5-flash',
            braintrustApiKey: settings.braintrustApiKey,
            braintrustProjectName: settings.braintrustProjectName,
            youApiKey: settings.youApiKey,
            computerUseEngine: settings.computerUseEngine || 'gateway-flash-lite',
          },
          initialContext: initialPageContext ? {
            currentUrl,
            pageContext: initialPageContext,
          } : undefined,
          metadata: {
            timestamp: Date.now(),
          },
        };
        
        // Execute workflow
        const { browserAutomationWorkflow } = await import('./workflows/browser-automation-workflow');
        const workflowOutput = await browserAutomationWorkflow(workflowInput, {
          executeTool,
          enrichToolResponse: enrichToolResponseForWorkflow,
          getPageContextAfterAction,
          updateLastMessage,
          pushMessage,
          settings: workflowInput.settings,
          messages,
          abortSignal: abortControllerRef.current?.signal,
          onApprovalRequired: handleApprovalRequired,
        });
        
        // Log workflow completion
        console.log(`🏁 [Gateway Computer Use] Workflow completed:`, {
          success: workflowOutput.success,
          totalDuration: workflowOutput.duration,
          finalUrl: workflowOutput.streaming?.executionSteps?.slice(-1)[0]?.url || null,
          steps: workflowOutput.streaming?.executionSteps?.length || 0,
          workflowId: workflowOutput.metadata?.workflowId,
          hasSummarization: !!workflowOutput.summarization,
          summaryLength: workflowOutput.summarization?.summary?.length || 0,
        });
        
        // Ensure final summary is displayed (fix for streaming not updating UI)
        if (workflowOutput.summarization?.success && workflowOutput.summarization.summary) {
          console.log('📊 [Gateway Computer Use] Displaying successful summary (', workflowOutput.summarization.summary.length, 'chars)');

          // Import task manager for workflow tasks
          const { convertLegacyTasks } = await import('./lib/task-manager');

          // Always push a final summary message to ensure it's visible
          // This ensures the summary shows even if streaming updates didn't work
          const finalSummaryMessage: Message = buildFinalSummaryMessage(workflowOutput);

          console.log('📝 [Gateway Computer Use] Final summary message prepared:', {
            id: finalSummaryMessage.id,
            role: finalSummaryMessage.role,
            contentLength: finalSummaryMessage.content.length,
            hasSummarization: !!finalSummaryMessage.summarization,
            hasExecutionTrajectory: !!finalSummaryMessage.executionTrajectory,
            contentPreview: finalSummaryMessage.content.substring(0, 100) + '...',
            contentSample: finalSummaryMessage.content.split('\n').slice(0, 5).join('\n')
          });

          // Use @ai-sdk-tools/store API correctly - just push the message
          // The store will handle state updates
          console.log('📝 [Gateway Computer Use] About to push final summary message:', {
            messageId: finalSummaryMessage.id,
            messageContentLength: finalSummaryMessage.content.length,
            currentMessagesLength: messages.length
          });

           try {
             // Replace the most recent summary if one already exists to avoid duplicates
             const current = Array.isArray(messages) ? messages : [];
             const lastSummaryIndexFromEnd = current
               .slice()
               .reverse()
               .findIndex(m => m.role === 'assistant' && m.content?.includes('Summary & Next Steps'));
             if (lastSummaryIndexFromEnd >= 0) {
               const idx = current.length - 1 - lastSummaryIndexFromEnd;
               const existing = current[idx];
               if (existing) {
                 console.log('♻️  [Gateway Computer Use] Replacing prior summary message:', { id: existing.id, idx });
                 replaceMessageById(existing.id, { ...finalSummaryMessage, id: existing.id });
               } else {
                 pushMessage(finalSummaryMessage);
               }
             } else {
               const result = pushMessage(finalSummaryMessage);
               console.log('✅ [Gateway Computer Use] Successfully pushed final summary message:', {
                 result,
                 messageId: finalSummaryMessage.id,
                 newMessagesLength: messages.length + 1
               });
             }
           } catch (error) {
             console.error('❌ [Gateway Computer Use] Failed to push/replace final summary message:', error);
             // Fallback: try again with a slight delay
             console.log('🔄 [Gateway Computer Use] Retrying in 100ms...');
             setTimeout(() => {
               try {
                 const retryResult = pushMessage(finalSummaryMessage);
                 console.log('✅ [Gateway Computer Use] Retry successful:', retryResult);
               } catch (retryError) {
                 console.error('❌ [Gateway Computer Use] Retry also failed:', retryError);
               }
             }, 100);
           }

          // Scroll to bottom to ensure the summary is visible
          setTimeout(() => {
            scrollToBottom(true);
            console.log('📜 [Gateway Computer Use] Scrolled to bottom to show summary');
            resumeAutoscrollIfNearBottom();
          }, 100);

          // Verify message was added
          console.log('📝 [Gateway Computer Use] Current messages count after push:', messages.length + 1);
          console.log('✅ [Gateway Computer Use] Final summary message pushed to UI');
        } else {
          console.warn('⚠️ [Gateway Computer Use] Summarization failed or missing', {
            hasSummarization: !!workflowOutput.summarization,
            summarizationSuccess: workflowOutput.summarization?.success,
            summaryLength: workflowOutput.summarization?.summary?.length || 0,
            error: workflowOutput.summarization?.error,
          });

          // Build a unified fallback summary and replace/prioritize it
          const completionMessage: Message = buildFinalSummaryMessage(workflowOutput);
          try {
            const current = Array.isArray(messages) ? messages : [];
            const lastSummaryIndexFromEnd = current
              .slice()
              .reverse()
              .findIndex(m => m.role === 'assistant' && m.content?.includes('Summary & Next Steps'));
            if (lastSummaryIndexFromEnd >= 0) {
              const idx = current.length - 1 - lastSummaryIndexFromEnd;
              const existing = current[idx];
              if (existing) {
                console.log('♻️  [Gateway Computer Use] Replacing prior summary (fallback):', { id: existing.id, idx });
                replaceMessageById(existing.id, { ...completionMessage, id: existing.id });
              } else {
                pushMessage(completionMessage);
              }
            } else {
              pushMessage(completionMessage);
            }
          } catch (error) {
            console.error('❌ [Gateway Computer Use] Failed to push/replace fallback summary:', error);
            setTimeout(() => pushMessage(completionMessage), 100);
          }
        }
        
        return workflowOutput;
      },
      { workflow_type: 'browser_tools_gateway', initial_message: messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '' }
    );
  };

  const streamGoogle = async (messages: Message[], signal: AbortSignal) => {
    // Ensure API credentials are available
    const apiKey = ensureApiKey();
    const model = ensureModel();

    // Add initial assistant message
    const assistantMessage: Message = {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
    };
    pushMessage(assistantMessage);

    if (!messages || messages.length === 0) {
      throw new Error('No messages provided to stream');
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: messages.map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content || '' }],
          })),
        }),
        signal,
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Google API request failed');
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const json = JSON.parse(line);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            appendToLastMessage(text);
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  };

  // Stream with AI SDK (for gateway provider without MCP tools)
  const streamWithAISDK = async (messages: Message[]) => {
    try {
      // Use wrapped AI SDK for Braintrust tracing
      const { getWrappedAI } = await import('./lib/ai-wrapped');
      const aiModule = await getWrappedAI(settings?.braintrustApiKey);
      const { streamText } = aiModule;

      // Import the appropriate provider SDK based on settings
      let model;
      if (settings!.provider === 'gateway') {
        if (!settings?.apiKey) {
          throw new Error('AI Gateway API key is required. Please set it in settings.');
        }
        console.log('🔑 [streamWithAISDK] Creating AI Gateway client with key:', settings.apiKey.substring(0, 10) + '...');
        const { createGateway } = await import('@ai-sdk/gateway');
        const gatewayClient = createGateway({ apiKey: settings.apiKey });
        model = gatewayClient(settings.model);
        console.log('✅ [streamWithAISDK] AI Gateway client created for model:', settings.model);
      } else if (settings!.provider === 'openrouter') {
        if (!settings?.apiKey) {
          throw new Error('OpenRouter API key is required. Please set it in settings.');
        }
        console.log('🔑 [streamWithAISDK] Creating OpenRouter client with key:', settings.apiKey.substring(0, 10) + '...');
        const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
        const openRouterClient = createOpenRouter({
          apiKey: settings.apiKey,
          headers: {
            'HTTP-Referer': chrome.runtime.getURL(''),
            'X-Title': 'Opulent Browser',
          },
        });
        model = openRouterClient.chat(settings.model);
        console.log('✅ [streamWithAISDK] OpenRouter client created for model:', settings.model);
      } else if (settings!.provider === 'nim') {
        if (!settings?.apiKey) {
          throw new Error('NVIDIA NIM API key is required. Please set it in settings.');
        }
        console.log('🔑 [streamWithAISDK] Creating NVIDIA NIM client with key:', settings.apiKey.substring(0, 10) + '...');
        const { createOpenAI } = await import('@ai-sdk/openai');
        // NIM uses OpenAI-compatible API
        const nimClient = createOpenAI({
          apiKey: settings.apiKey,
          baseURL: 'https://integrate.api.nvidia.com/v1',
        });
        model = nimClient(settings.model);
        console.log('✅ [streamWithAISDK] NVIDIA NIM client created for model:', settings.model);
      } else {
        if (!settings?.apiKey) {
          throw new Error('Google API key is required. Please set it in settings.');
        }
        const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
        const googleClient = createGoogleGenerativeAI({ apiKey: settings.apiKey });
        model = googleClient(settings.model);
      }

      // Convert messages to AI SDK format
      const aiMessages = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      const result = streamText({
        model,
        messages: aiMessages,
        abortSignal: abortControllerRef.current?.signal,
      });

      // Add initial assistant message
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: '',
      };
      pushMessage(assistantMessage);

      // Stream the response
      let fullText = '';
      for await (const chunk of result.textStream) {
        fullText += chunk;
        updateLastMessage((msg) => ({
          ...msg,
          content: msg.role === 'assistant' ? fullText : msg.content
        }));
      }
    } catch (error) {
      console.error('❌ Error streaming with AI SDK:', error);
      throw error;
    }
  };

  // New handler for AgentPromptComposer
  const handleComposerSubmit = async (query: string, options?: { persona?: any; files?: File[] }) => {
    if (!query.trim() || isLoading || !settings) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: query,
      metadata: options?.persona ? {
        persona: options.persona.name,
        personaPrompt: options.persona.systemPrompt,
        attachments: options.files?.map(f => f.name),
      } : undefined,
    };

    const newMessages = [...messages, userMessage];
    pushMessage(userMessage);
    setIsLoading(true);
    // Autoscroll handled by AutoStickWatcher

    abortControllerRef.current = new AbortController();

    try {
      // Browser tools are now MANDATORY - no more conditional checks
      // Auto-detect based on provider selection
      const engine = getComputerUseEngine();
          console.log('🔧 [handleSubmit] Browser tools MANDATORY - using engine', { provider: settings.provider, engine, hasApiKey: !!settings.apiKey, model: settings.model });

      // Gateway/OpenRouter providers use AI Gateway
      if (settings.provider === 'gateway' || settings.provider === 'openrouter') {
        if (!settings.apiKey) {
          updateLastMessage((msg) => ({
            ...msg,
            content: msg.role === 'assistant'
              ? '⚠️ **Browser Tools requires an API key**\n\nPlease:\n1. Open Settings (⚙️)\n2. Add your API key for your selected provider\n3. Try again'
              : msg.content
          }));
          setIsLoading(false);
          return;
        }

          if (mcpClientRef.current) {
            try { await mcpClientRef.current.close(); } catch {}
            mcpClientRef.current = null;
            mcpToolsRef.current = null;
          }

          console.log('🚀 [handleSubmit] Using Gateway Computer Use workflow');
          await streamWithGatewayComputerUse(newMessages);
        }

        setIsLoading(false);
      } catch (error: any) {
        console.error('❌ Chat error occurred:');
        console.error('Error type:', typeof error);
        console.error('Error name:', error?.name);
        console.error('Error message:', error?.message);
        console.error('Error stack:', error?.stack);
        console.error('Full error object:', error);

        if (error.name !== 'AbortError') {
          // Show detailed error message to user
          const errorDetails = error?.stack || JSON.stringify(error, null, 2);
          pushMessage({
            id: Date.now().toString(),
            role: 'assistant',
            content: `Error: ${error.message}\n\nDetails:\n\`\`\`\n${errorDetails}\n\`\`\``,
          });
        }
        setIsLoading(false);
      }
  };

  // Handle follow-up option click
  const handleFollowUpOptionClick = async (prompt: string) => {
    try {
      await handleComposerSubmit(prompt);
    } catch (e) {
      console.error('Failed to submit follow-up option:', e);
    }
  };

  // Render a small form for input-style follow-ups
  const FollowUpsInputForm = ({ messageId, inputs }: { messageId: string; inputs: Array<{ type: string; question: string; placeholder?: string | number; suggestions?: string[] }> }) => {
    const [answers, setAnswers] = useState<Record<number, string | number>>({});

    const handleChange = (idx: number, value: string) => {
      setAnswers((prev) => ({ ...prev, [idx]: value }));
    };

    const handleSubmitInputs = async () => {
      const compiled = inputs
        .map((q, idx) => `- ${q.question}: ${answers[idx] ?? ''}`)
        .join('\n');
      const prompt = `Follow-up answers for previous step:\n${compiled}`;
      await handleComposerSubmit(prompt);
    };

    return (
      <div className="mt-2 rounded-lg border border-border bg-card p-2 space-y-2">
        <div className="text-sm font-medium text-foreground">Follow-Ups</div>
        {inputs.map((q, idx) => {
          const inputId = `${messageId}-fu-${idx}`;
          const dataListId = `${messageId}-fu-dl-${idx}`;
          const type = q.type === 'number' ? 'number' : q.type === 'date' ? 'date' : 'text';
          return (
            <div key={inputId} className="flex items-center gap-2">
              <label htmlFor={inputId} className="min-w-36 text-xs text-muted-foreground">
                {q.question}
              </label>
              <input
                id={inputId}
                type={type}
                list={q.suggestions && q.suggestions.length ? dataListId : undefined}
                placeholder={q.placeholder !== undefined ? String(q.placeholder) : ''}
                className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
                onChange={(e) => handleChange(idx, e.target.value)}
              />
              {q.suggestions && q.suggestions.length > 0 && (
                <datalist id={dataListId}>
                  {q.suggestions.map((s, i) => (
                    <option key={`${dataListId}-${i}`} value={s} />
                  ))}
                </datalist>
              )}
            </div>
          );
        })}
        <div className="pt-1">
          <Button size="sm" variant="secondary" onClick={handleSubmitInputs}>
            <Send className="h-3 w-3 opacity-75 mr-1" /> Submit
          </Button>
        </div>
      </div>
    );
  };

  // Auto-scroll behavior handled by use-stick-to-bottom via Conversation wrapper.
  // We still keep a simple flag to reset any manual scroll gating when user sends a message.

  if (showSettings && !settings) {
    return (
      <div className="relative flex h-screen w-full flex-col overflow-hidden bg-secondary">
        <div className="flex h-full w-full flex-col">
          <div className="chat-header border-b bg-background/95">
            <div style={{ flex: 1 }}>
              <h1 className="text-lg font-semibold text-foreground">Opulent</h1>
              <p style={{ marginBottom: '20px' }}>Please configure your AI provider to get started.</p>
              <button
                type="button"
                onClick={openSettings}
                className="settings-icon-btn"
                style={{ width: 'auto', padding: '12px 24px' }}
              >
                Open Settings
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen w-full flex-col overflow-hidden bg-secondary">
      <div className="flex h-full w-full flex-col chat-interface">
        <div className="chat-header border-b bg-background/95 backdrop-blur-sm">
          <div style={{ flex: 1 }}>
            <h1 className="text-lg font-semibold text-foreground">Opulent</h1>
            <p className="text-sm text-muted-foreground">
              {(settings?.provider
                ? settings.provider === 'gateway' ? 'AI Gateway' : settings.provider.charAt(0).toUpperCase() + settings.provider.slice(1)
                : 'Unknown')} · {settings?.model || getComputerUseLabel()}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={toggleBrowserTools}
              className="settings-icon-btn transition-all duration-200 hover:scale-105 active"
              title="Browser Tools (Always Enabled)"
              disabled={isLoading}
            >
              ◉
            </button>
            <button
              onClick={newChat}
              className="settings-icon-btn transition-all duration-200 hover:scale-105"
              title="New Chat"
              disabled={isLoading}
            >
              +
            </button>
            <button
              onClick={openSettings}
              className="settings-icon-btn transition-all duration-200 hover:scale-105"
              title="Settings"
            >
              ⋯
            </button>
          </div>
        </div>

        {showBrowserToolsWarning && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-sm text-amber-800">
            <strong>Browser Tools Active!</strong> Using {getComputerUseLabel()}.
            {!settings?.apiKey && (
              <span> Please <a href="#" onClick={(e) => { e.preventDefault(); openSettings(); }} className="text-blue-600 underline hover:text-blue-800">set your API key</a> in settings.</span>
            )}
          </div>
        )}

        <div className="flex-1 overflow-hidden">
          <Conversation className="h-full">
            <ConversationContent className="h-full" data-testid="chat-messages">
              <AutoStickWatcher count={(Array.isArray(messages) ? messages : []).length} lastRole={(Array.isArray(messages) && messages.length > 0) ? messages[messages.length - 1].role : undefined} />
              {(!Array.isArray(messages) || messages.length === 0) ? (
                <div className="flex h-full items-center justify-center">
                  <div className="welcome-message text-center">
                    <h2 className="mb-4 text-2xl font-bold text-foreground">How can I help you today?</h2>
                    <p className="text-muted-foreground">I'm Opulent, your AI assistant. I can help you browse the web, analyze content, and perform various tasks.</p>
                  </div>
                </div>
              ) : (
                <>
                  {(Array.isArray(messages) ? messages : []).map((message, index) => {
                    // Debug logging for message rendering
                    if (message.content?.includes('Summary & Next Steps')) {
                      console.log('🎨 [UI] Rendering summary message:', {
                        id: message.id,
                        role: message.role,
                        contentLength: message.content.length,
                        hasSummarization: !!message.summarization,
                        hasWorkflowTasks: !!message.workflowTasks,
                        contentPreview: message.content.substring(0, 200) + '...',
                        messageKeys: Object.keys(message)
                      });
                    }

                    // Filter out intermediate reasoning updates - they clutter the UI
                    if (message.role === 'assistant' && message.content.includes('💭 **Reasoning Update**')) {
                      return null;
                    }

                    // Never filter out summary messages - always show them
                    if (message.content?.includes('Summary & Next Steps')) {
                      console.log('🎯 [UI] Ensuring summary message is visible');
                    }

                    const isStepMessage = message.role === 'assistant' && (
                      message.content.includes('**Step') ||
                      message.content.includes('Planning Phase') ||
                      message.content.includes('Planning Complete')
                    );

                    return (
                      <div
                        key={message.id}
                        className="mx-auto w-full max-w-4xl animate-in fade-in slide-in-from-bottom-1 duration-200 py-2"
                      >
                        <MessageComponent from={message.role as "user" | "assistant"}>
                          <MessageContent
                            className={cn(
                              message.role === 'user' 
                                ? "rounded-xl rounded-br-sm border bg-background text-foreground"
                                : "bg-transparent text-foreground"
                            )}
                          >
                            {message.content ? (
                              <>
                                {/* Show content based on message type */}
                                {message.role === 'assistant' ? (
                                  <>
                                    {/* Display tool executions using enhanced structured component */}
                                    {message.toolExecutions && message.toolExecutions.length > 0 && (
                                      <div style={{ marginBottom: '8px' }}>
                                        <EnhancedToolCallDisplay 
                                          toolParts={message.toolExecutions.map(exec => ({
                                            type: exec.toolName,
                                            state: exec.state,
                                            input: exec.input,
                                            output: exec.output,
                                            toolCallId: exec.toolCallId,
                                            errorText: exec.errorText,
                                          }))}
                                        />
                                      </div>
                                    )}
                                    
                                    {/* Display workflow task list (mastra-hitl inspired clean UI) */}
                                    {message.workflowTasks && message.workflowTasks.length > 0 && (
                                      <WorkflowTaskList
                                        tasks={message.workflowTasks}
                                        autoExpand={index === messages.length - 1}
                                        emphasizedTasks={new Set(
                                          message.workflowTasks
                                            .filter(t => t.status === 'new' || t.status === 'in_progress')
                                            .map(t => t.id)
                                        )}
                                      />
                                    )}
                                    
                                    {/* Display reasoning tokens (OpenRouter/Atlas chain-of-thought) - AI Elements primitive */}
                                    {message.reasoning && message.reasoning.length > 0 && (
                                      <div style={{ marginBottom: '8px' }}>
                                        <Reasoning 
                                          isStreaming={isLoading && index === messages.length - 1}
                                          defaultOpen={false}
                                          className="rounded-lg border border-border bg-card"
                                        >
                                          <ReasoningTrigger />
                                          <ReasoningContent className="space-y-2 pt-3">
                                            {message.reasoning.map((thought, idx) => (
                                              <div 
                                                key={`thought-${idx}`}
                                                className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground"
                                              >
                                                <div className="font-medium text-foreground mb-1">
                                                  Thought {idx + 1}
                                                </div>
                                                <div className="whitespace-pre-wrap">
                                                  {thought}
                                                </div>
                                              </div>
                                            ))}
                                          </ReasoningContent>
                                        </Reasoning>
                                      </div>
                                    )}
                                    
                                    {/* Display planning using enhanced structured component */}
                                    {message.planning && (
                                      <div style={{ marginBottom: '8px' }}>
                                        <EnhancedPlanDisplay 
                                          plan={message.planning.plan}
                                          confidence={message.planning.confidence}
                                          defaultOpen={false}
                                        />
                                      </div>
                                    )}
                                    
                                    {/* Display page context artifact */}
                                    {message.pageContext && (
                                      <div style={{ marginBottom: '8px' }}>
                                        <PageContextArtifact pageContext={message.pageContext} />
                                      </div>
                                    )}
                                    
                                    {/* Display summarization artifact */}
                                    {message.summarization && (
                                      <div style={{ marginBottom: '8px' }}>
                                        <SummarizationArtifact summarization={message.summarization} />
                                      </div>
                                    )}

                                    {/* Render Follow-Ups as clickable buttons (basic UI) */}
                                    {message?.metadata?.hasFollowUps && message?.metadata?.followUps?.select && (
                                      <div className="mt-2 rounded-lg border border-border bg-card p-2">
                                        <div className="mb-2 text-sm font-medium text-foreground">Follow-Ups</div>
                                        <div className="flex flex-wrap gap-2">
                                          {message.metadata.followUps.select.map((opt: any, idx: number) => (
                                            <Button
                                              key={`${message.id}-fu-${idx}`}
                                              size="sm"
                                              variant="secondary"
                                              onClick={() => handleFollowUpOptionClick(opt.prompt)}
                                              title={opt.prompt}
                                            >
                                              <span className="mr-1">{opt.emoji}</span>
                                              {opt.title}
                                              <Send className="ml-2 h-3 w-3 opacity-75" />
                                            </Button>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {message?.metadata?.hasFollowUps && message?.metadata?.followUps?.input && (
                                      <FollowUpsInputForm messageId={message.id} inputs={message.metadata.followUps.input} />
                                    )}
                                    
                                    {/* Display error analysis artifact */}
                                    {message.errorAnalysis && (
                                      <div style={{ marginBottom: '12px' }}>
                                        <ErrorAnalysisArtifact errorAnalysis={message.errorAnalysis} />
                                      </div>
                                    )}
                                    
                                    {/* Display execution trajectory artifact */}
                                    {message.executionTrajectory && message.executionTrajectory.length > 0 && (
                                      <div style={{ marginBottom: '12px' }}>
                                        <ExecutionTrajectoryArtifact trajectory={message.executionTrajectory} />
                                      </div>
                                    )}
                                    
                                    {/* Display workflow metadata artifact */}
                                    {message.workflowMetadata && (
                                      <div style={{ marginBottom: '12px' }}>
                                        <WorkflowMetadataArtifact 
                                          metadata={message.workflowMetadata}
                                          totalDuration={message.workflowMetadata.totalDuration}
                                          finalUrl={message.workflowMetadata.finalUrl}
                                        />
                                      </div>
                                    )}
                                    
                                    {/* Display step visualization using prompt-kit Steps component */}
                                    {isStepMessage && (
                                      <div style={{ marginBottom: '12px' }}>
                                        <EnhancedStepDisplay messages={[message]} />
                                      </div>
                                    )}
                                    
                                    {/* Thinking indicator: Show when tools are processing or when content indicates continuation */}
                                    {(() => {
                                      const processingTools = message.toolExecutions?.filter(e => e.state === 'input-streaming') || [];
                                      const hasProcessingTools = processingTools.length > 0;
                                      const isContinuing = message.content?.includes('_Continuing') || message.content?.includes('_Executing step');
                                      
                                      if (hasProcessingTools || (isContinuing && !message.content.match(/\*\*|#|Step \d+:/))) {
                                        return (
                                          <div style={{ 
                                            padding: '12px', 
                                            background: 'rgba(59, 130, 246, 0.05)',
                                            borderRadius: '6px',
                                            marginBottom: '8px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            fontSize: '13px',
                                            color: '#6b7280'
                                          }}>
                                            <svg className="animate-spin h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            <span>
                                              {hasProcessingTools ? 'Processing tools...' : 'Thinking...'}
                                            </span>
                                          </div>
                                        );
                                      }
                                      return null;
                                    })()}
                                    
                                    {/* Enhanced Response primitive for streaming content */}
                                    <Response>{message.content}</Response>
                                  </>
                                ) : (
                                  <Response>{message.content}</Response>
                                )}
                              </>
                            ) : (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span>Generating response...</span>
                              </div>
                            )}
                          </MessageContent>
                        </MessageComponent>
                      </div>
                    );
                  })}
                </>
              )}
            </ConversationContent>
            {/* Show scroll-to-bottom button when user scrolls up */}
            <ConversationScrollButton />

            {/* Fixed input form structure */}
            <div className="input-form backdrop-blur-sm">
              <div className="mx-auto max-w-4xl w-full">
                <AgentComposerIntegration
                  onSubmit={handleComposerSubmit}
                  isLoading={isLoading}
                  disabled={!settings?.apiKey}
                  showSettings={true}
                  onSettingsClick={() => setShowSettings(true)}
                  modelSelector={settings && (
                    <ModelMorphDropdown
                      provider={settings.provider}
                      value={settings.model}
                      label="Model"
                      onSelect={(modelId) => {
                        try {
                          const next = { ...(settings || {}), model: modelId } as Settings;
                          chrome.storage.local.set({ atlasSettings: next }, () => {
                            setSettings(next);
                          });
                        } catch (e) {
                          console.error('Failed to update model:', e);
                        }
                      }}
                    />
                  )}
                />
              </div>
            </div>
          </Conversation>
        </div>
      </div>
      
      <div ref={messagesEndRef} />
      
      {/* AI SDK Devtools - shows streaming events, tool calls, and performance metrics */}
      {settings?.devtoolsEnabled && (
        <AIDevtools
          modelId={browserToolsEnabled ? getComputerUseLabel() : (settings?.model || 'unknown')}
          debug={false}
        />
      )}
      
      {/* Approval Modal for tool execution */}
      {currentApproval && (
        <ApprovalModal
          open={approvalModalOpen}
          onOpenChange={setApprovalModalOpen}
          approval={currentApproval}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}
    </div>
  );
}

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
  <Provider initialMessages={[] as any}>
    <ChatSidebar />
  </Provider>
);
