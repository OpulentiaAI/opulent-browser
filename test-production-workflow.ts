#!/usr/bin/env node

// Production test for browser automation workflow fixes
// Tests with real API keys and captures server logs in real-time
// Enhanced with telemetry for summarization content analysis

import { browserAutomationWorkflow } from './workflows/browser-automation-workflow.ts';
import type { BrowserAutomationWorkflowInput, Message } from './types.ts';

// Mock Chrome APIs for Node.js environment
(globalThis as Record<string, unknown>).chrome = {
  runtime: {
    getURL: () => 'chrome-extension://test/',
  }
};

// Telemetry storage for analysis
interface TelemetryData {
  timestamp: string;
  testId: string;
  config: {
    model: string;
    provider: string;
    toolMode: string;
    computerUseEngine: string;
  };
  execution: {
    totalDuration: number;
    planningDuration: number;
    executionDuration: number;
    summarizationDuration: number;
    stepsCount: number;
    toolCallsCount: number;
    success: boolean;
    finalUrl: string;
    authError?: string | null;
  };
  summarization: {
    success: boolean;
    summaryLength: number;
    summaryContent: string;
    error?: string;
    fallbackUsed: boolean;
  };
  pageContexts: {
    initial: string;
    final: string;
    navigationSteps: string[];
  };
  approvals: {
    toolName: string;
    params: Record<string, unknown>;
    timestamp: string;
    approved: boolean;
  }[];
}

async function testProductionWorkflow() {
  const testId = 'telemetry-test-' + Date.now();
  console.log('🚀 Starting Production Browser Automation Workflow Test with Telemetry...\n');
  console.log('📊 Test ID:', testId);

  // Production config with real API keys (from settings.tsx)
  const prodConfig: BrowserAutomationWorkflowInput = {
    userQuery: `go to espn and summarize latest news - ${Date.now()}`, // Add timestamp to avoid cache

    settings: {
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini', // Try OpenAI model which has better tool calling support
      apiKey: process.env.OPENROUTER_API_KEY || process.env.AI_GATEWAY_API_KEY || '',
      youApiKey: process.env.YOU_API_KEY || '',
      braintrustApiKey: process.env.BRAINTRUST_API_KEY || '',
    },
    initialContext: {
      pageContext: {
        url: 'https://example.com',
        title: 'Example Domain',
        textContent: 'This domain is for use in illustrative examples in documents.',
        links: [],
        images: [],
        forms: [],
        metadata: {},
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      }
    },
    metadata: {
      conversationId: testId,
    }
  };

  // Telemetry collection
  const telemetry: TelemetryData = {
    timestamp: new Date().toISOString(),
    testId,
    config: {
      model: prodConfig.settings.model,
      provider: prodConfig.settings.provider,
      toolMode: prodConfig.settings.toolMode,
      computerUseEngine: prodConfig.settings.computerUseEngine,
    },
    execution: {
      totalDuration: 0,
      planningDuration: 0,
      executionDuration: 0,
      summarizationDuration: 0,
      stepsCount: 0,
      toolCallsCount: 0,
      success: false,
      finalUrl: '',
    },
    summarization: {
      success: false,
      summaryLength: 0,
      summaryContent: '',
      fallbackUsed: false,
    },
    pageContexts: {
      initial: prodConfig.initialContext.pageContext.url,
      final: '',
      navigationSteps: [],
    },
    approvals: [],
  };

  // Mock context for testing with telemetry hooks
  const mockContext = {
    executeTool: async (toolName: string, params: Record<string, unknown>) => {
      console.log(`🔧 [TOOL] ${toolName}:`, params);
      telemetry.execution.toolCallsCount++;

      // Track navigation steps
      if (toolName === 'navigate') {
        telemetry.pageContexts.navigationSteps.push(params.url);
      }

      // Simulate tool execution with realistic delays
      await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));

      switch (toolName) {
        case 'navigate':
          return {
            success: true,
            url: params.url,
            pageContext: {
              url: params.url,
              title: 'ESPN - Sports News',
              textContent: 'Latest sports news and scores from ESPN. Breaking: Lakers win NBA championship. NFL draft results are in. Major League Baseball updates.',
              links: [{ text: 'NFL', href: '/nfl' }, { text: 'NBA', href: '/nba' }],
              images: [],
              forms: [],
              metadata: {},
              viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
            }
          };
        case 'getPageContext': {
          const finalUrl = 'https://www.espn.com';
          telemetry.pageContexts.final = finalUrl;
          return {
            success: true,
            url: finalUrl,
            title: 'ESPN - Sports News',
            textContent: 'Breaking news: Los Angeles Lakers win NBA championship in thrilling Game 7. NFL draft complete with surprise picks. MLB trade deadline approaches with big moves expected. College football rankings shake up after weekend upsets.',
            links: [{ text: 'NFL', href: '/nfl' }, { text: 'NBA', href: '/nba' }],
            images: [],
            forms: [],
            metadata: {},
            viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
          };
        }
        default:
          return { success: true, url: 'https://www.espn.com' };
      }
    },
    enrichToolResponse: async (res: Record<string, unknown>, _toolName: string) => {
      return {
        success: res?.success !== false,
        url: res?.url || 'https://www.espn.com',
        pageContext: res?.pageContext,
      };
    },
    getPageContextAfterAction: async () => {
      const finalUrl = 'https://www.espn.com';
      telemetry.pageContexts.final = finalUrl;
      return {
        url: finalUrl,
        title: 'ESPN - Sports News',
        textContent: 'Latest sports news and scores from ESPN. Lakers championship celebration continues.',
        links: [],
        images: [],
        forms: [],
        metadata: {},
        viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      };
    },
    updateLastMessage: (_updater: (msg: Message) => Message) => {
      console.log('📝 [UI] Updating last message');
    },
    pushMessage: (msg: Message) => {
      console.log(`💬 [UI] New message: ${msg.content.substring(0, 100)}...`);
    },
    settings: prodConfig.settings,
    messages: [{
      id: 'test-msg-1',
      role: 'user' as const,
      content: prodConfig.userQuery,
    }],
    abortSignal: undefined,
    retryTask: (taskId: string) => console.log(`🔄 [TASK] Retrying ${taskId}`),
    cancelTask: (taskId: string) => console.log(`❌ [TASK] Cancelling ${taskId}`),
    onApprovalRequired: async (toolName: string, params: Record<string, unknown>) => {
      console.log(`🔐 [TEST] Approval requested for ${toolName}:`, params);
      telemetry.approvals.push({
        toolName,
        params,
        timestamp: new Date().toISOString(),
        approved: true // Auto-approve for testing
      });
      console.log(`🔐 [TEST] Auto-approving ${toolName} for test`);
      return Promise.resolve(true);
    },
  };

  const startTime = Date.now();

  try {
    console.log('🎯 Starting workflow execution...');
    console.log('📋 Query:', prodConfig.userQuery);
    console.log('🔑 You.com API key present:', !!prodConfig.settings.youApiKey);
    console.log('🤖 Model:', prodConfig.settings.model);
    console.log('');

    const result = await browserAutomationWorkflow(prodConfig, mockContext);

    const duration = Date.now() - startTime;
    telemetry.execution.totalDuration = duration;
    telemetry.execution.finalUrl = result.finalUrl || '';
    telemetry.execution.success = true;

    console.log(`\n✅ Workflow completed in ${duration}ms`);
    console.log('📊 Results:');

    // Approval flow telemetry analysis
    console.log('🔐 Approval Flow Analysis:');
    console.log(`   - Total approval requests: ${telemetry.approvals.length}`);
    console.log(`   - Approved requests: ${telemetry.approvals.filter(a => a.approved).length}`);
    console.log(`   - Rejected requests: ${telemetry.approvals.filter(a => !a.approved).length}`);
    if (telemetry.approvals.length > 0) {
      console.log('   - Tools requiring approval:', telemetry.approvals.map(a => a.toolName).join(', '));
    }

    // Enhanced summarization analysis with telemetry
    if (result.summarization?.success) {
      console.log('✅ Summarization: SUCCESS');
      console.log('📝 Summary length:', result.summarization.summary?.length || 0, 'chars');
      console.log('⏱️  Duration:', result.summarization.duration, 'ms');
      
      // Capture detailed telemetry
      telemetry.summarization.success = true;
      telemetry.summarization.summaryLength = result.summarization.summary?.length || 0;
      telemetry.summarization.summaryContent = result.summarization.summary || '';
      telemetry.summarization.fallbackUsed = result.summarization.summary?.includes('fallback') || false;
      telemetry.execution.summarizationDuration = result.summarization.duration || 0;
      
      console.log('📊 Telemetry - Summary Quality Analysis:');
      console.log('   - Contains "Lakers":', telemetry.summarization.summaryContent.includes('Lakers') ? 'YES ✅' : 'NO ❌');
      console.log('   - Contains "NBA":', telemetry.summarization.summaryContent.includes('NBA') ? 'YES ✅' : 'NO ❌');
      console.log('   - Contains "ESPN":', telemetry.summarization.summaryContent.includes('ESPN') ? 'YES ✅' : 'NO ❌');
      console.log('   - Fallback used:', telemetry.summarization.fallbackUsed ? 'YES ⚠️' : 'NO ✅');
      
    } else {
      console.log('❌ Summarization: FAILED or TIMED OUT');
      console.log('🔍 Error:', result.summarization?.error || 'Unknown error');
      
      telemetry.summarization.success = false;
      telemetry.summarization.error = result.summarization?.error || 'Unknown error';
    }

    // Execution trajectory analysis
    console.log('🎯 Execution trajectory:', result.executionTrajectory?.length || 0, 'steps');
    telemetry.execution.stepsCount = result.executionTrajectory?.length || 0;
    
    if (result.planning) {
      telemetry.execution.planningDuration = result.planning.duration || 0;
      console.log('🧠 Planning duration:', telemetry.execution.planningDuration, 'ms');
    }
    
    if (result.execution) {
      telemetry.execution.executionDuration = result.execution.duration || 0;
      console.log('⚡ Execution duration:', telemetry.execution.executionDuration, 'ms');
    }
    
    console.log('🏁 Final URL:', result.finalUrl || 'N/A');
    console.log('⏱️  Total duration:', result.totalDuration || duration, 'ms');

    // Check if completion message would be shown
    const hasCompletionMessage = result.summarization?.summary ||
                                (result.executionTrajectory && result.executionTrajectory.length > 0);

    console.log('\n🎉 Completion message would be shown:', hasCompletionMessage ? 'YES ✅' : 'NO ❌');

    if (result.summarization?.summary) {
      console.log('📋 Full Summary Content:');
      console.log('=' .repeat(80));
      console.log(result.summarization.summary);
      console.log('=' .repeat(80));
    }

    // Check for authentication-specific errors (401, auth failures)
    const hasAuthError = result.error?.includes('401') || 
                        result.error?.toLowerCase().includes('auth') || 
                        result.error?.toLowerCase().includes('unauthorized') ||
                        result.error?.toLowerCase().includes('credentials');

    if (hasAuthError) {
      console.log('❌ AUTHENTICATION ERROR DETECTED:');
      console.log(`   Error: ${result.error}`);
      telemetry.execution.authError = result.error;
      telemetry.execution.success = false;
    } else {
      console.log('✅ No authentication errors detected');
      telemetry.execution.authError = null;
    }

    // Save telemetry data
    await saveTelemetryData(telemetry);

  } catch (error) {
    const duration = Date.now() - startTime;
    telemetry.execution.totalDuration = duration;
    telemetry.execution.success = false;
    
    // Check for authentication errors in catch block too
    const errorMessage = error instanceof Error ? error.message : String(error);
    const authError = errorMessage.includes('401') || 
                     errorMessage.toLowerCase().includes('auth') || 
                     errorMessage.toLowerCase().includes('unauthorized') ||
                     errorMessage.toLowerCase().includes('credentials');
    
    if (authError) {
      console.log('❌ AUTHENTICATION ERROR DETECTED:');
      console.log(`   Error: ${errorMessage}`);
      telemetry.execution.authError = errorMessage;
    } else {
      console.log(`\n❌ Workflow failed after ${duration}ms:`, error);
    }
    
    // Save error telemetry
    await saveTelemetryData(telemetry);
  }
}

// Save telemetry data to file for analysis
async function saveTelemetryData(telemetry: TelemetryData) {
  try {
    const fs = await import('fs');
    const telemetryFile = `./tmp/telemetry-${telemetry.testId}.json`;
    
    // Ensure tmp directory exists
    if (!fs.existsSync('./tmp')) {
      fs.mkdirSync('./tmp', { recursive: true });
    }
    
    fs.writeFileSync(telemetryFile, JSON.stringify(telemetry, null, 2));
    console.log(`\n💾 Telemetry saved to: ${telemetryFile}`);
    
    // Also update latest telemetry file
    const latestFile = './tmp/latest-telemetry.json';
    fs.writeFileSync(latestFile, JSON.stringify(telemetry, null, 2));
    console.log(`📊 Latest telemetry updated: ${latestFile}`);
    
  } catch (error) {
    console.error('❌ Failed to save telemetry:', error);
  }
}

// Run the test
testProductionWorkflow().catch(console.error);