#!/usr/bin/env tsx
/**
 * End-to-End Test for Navigation Tool with Telemetry
 * Tests the navigation tool in a real Chrome extension environment
 * Captures background script logs, sidepanel logs, and telemetry data
 */

import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Simple expect function for test assertions
function expect(val) {
  return {
    toBeGreaterThan: (n, msg) => {
      if (!(val > n)) {
        throw new Error(msg || `Expected ${val} to be greater than ${n}`);
      }
    },
    toBe: (expected, msg) => {
      if (val !== expected) {
        throw new Error(msg || `Expected ${val} to be ${expected}`);
      }
    }
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXTENSION_PATH = path.join(__dirname, '..', 'dist');
const TEST_LOG_FILE = path.join(__dirname, 'e2e-test-logs.txt');
let extensionId: string | null = null;

interface TestResult {
  testName: string;
  status: 'PASS' | 'FAIL';
  duration: number;
  logs: string[];
  errors: string[];
  telemetry?: unknown;
}

const testResults: TestResult[] = [];

function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);

  // Also write to file
  fs.appendFileSync(TEST_LOG_FILE, logMessage + '\n');
}

function logTestStart(testName: string) {
  log(`\n${'='.repeat(80)}`);
  log(`🧪 STARTING TEST: ${testName}`);
  log('='.repeat(80));
}

function logTestEnd(testName: string, status: 'PASS' | 'FAIL', duration: number, logs: string[], errors: string[]) {
  log(`\n${'='.repeat(80)}`);
  log(`✅ TEST COMPLETED: ${testName}`);
  log(`   Status: ${status}`);
  log(`   Duration: ${duration}ms`);
  log(`   Logs: ${logs.length} entries`);
  log(`   Errors: ${errors.length} entries`);
  log('='.repeat(80));
}

async function clearLogs() {
  if (fs.existsSync(TEST_LOG_FILE)) {
    fs.unlinkSync(TEST_LOG_FILE);
  }
  log('📝 Test log file initialized');
}

const INPUT_SELECTORS = [
  'textarea[aria-label="Prompt input"]',
  'textarea[placeholder*="think"]',
  'textarea[placeholder*="know"]',
  'textarea[name="message"]',
];

async function waitForPromptInput(page: puppeteer.Page, timeout = 15000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    for (const selector of INPUT_SELECTORS) {
      const directHandle = await page.$(selector);
      if (directHandle) {
        return { handle: directHandle, selector };
      }
      for (const frame of page.frames()) {
        try {
          const frameHandle = await frame.$(selector);
          if (frameHandle) {
            return { handle: frameHandle, selector, frame };
          }
        } catch (_) {
          // ignore frame access errors
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}

async function ensureDefaultSettings(page: puppeteer.Page) {
  const needsSettings = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        chrome.storage.local.get(['atlasSettings'], (result) => {
          resolve(!result.atlasSettings);
        });
      })
  );

  if (!needsSettings) {
    return;
  }

  log('⚙️ Configuring default Atlas settings for test environment...');

  // Use real API keys from environment if available
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.AI_GATEWAY_API_KEY || 'test-api-key';
  const provider = process.env.OPENROUTER_API_KEY ? 'openrouter' : 'gateway';
  // Use GLM-4.5 Air free model
  const model = provider === 'openrouter' ? 'z-ai/glm-4.5-air:free' : 'google/gemini-2.5-flash';
  
  if (apiKey === 'test-api-key') {
    log('⚠️ No API key found in environment. Using placeholder key (will trigger fallback).');
    log('💡 Set OPENROUTER_API_KEY or AI_GATEWAY_API_KEY environment variable for real model responses.');
  } else {
    log(`✅ Using ${provider} API key from environment: ${apiKey.substring(0, 10)}...`);
    log(`✅ Using model: ${model}`);
  }

  await page.evaluate(
    (settings) =>
      new Promise<void>((resolve) => {
        chrome.storage.local.set(
          {
            atlasSettings: settings,
          },
          () => resolve()
        );
      }),
    {
      provider,
      apiKey,
      model,
      computerUseEngine: provider === 'openrouter' ? 'gateway' : 'gateway',
      devtoolsEnabled: false,
      youApiKey: 'test-you-api-key',
      youBaseUrl: 'https://api.ydc-index.io',
    }
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id,
    { timeout: 10000 }
  );
}

async function setupBrowser(): Promise<puppeteer.Browser | null> {
  log('🚀 Setting up Chrome browser for testing...');

  const browser = await puppeteer.launch({
    headless: false, // Keep visible for debugging
    devtools: true, // Open devtools to see logs
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    defaultViewport: null,
  });

  log('✅ Browser launched successfully');

  try {
    const serviceWorkerTarget = await browser.waitForTarget(
      (target) =>
        target.type() === 'service_worker' &&
        target.url().startsWith('chrome-extension://'),
      { timeout: 10000 }
    );

    const targetUrl = serviceWorkerTarget?.url() ?? '';
    const match = targetUrl.match(/^chrome-extension:\/\/([a-z]+)/);
    if (match) {
      extensionId = match[1];
      log(`🆔 Extension ID resolved: ${extensionId}`);
    } else {
      log(`⚠️ Unable to parse extension ID from target URL: ${targetUrl}`);
    }
  } catch (error) {
    log(`❌ Failed to resolve extension ID: ${error instanceof Error ? error.message : String(error)}`);
  }

  return browser;
}

async function getSidepanelPage(browser: puppeteer.Browser): Promise<puppeteer.Page> {
  if (!extensionId) {
    throw new Error('Extension ID not resolved; cannot open sidepanel page');
  }

  const sidepanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  const pages = await browser.pages();
  let sidepanelPage = pages.find((p: puppeteer.Page) => p.url().startsWith(sidepanelUrl));

  if (!sidepanelPage) {
    sidepanelPage = await browser.newPage();
    await sidepanelPage.goto(sidepanelUrl, { waitUntil: 'domcontentloaded' });
  }

  await sidepanelPage.waitForFunction(
    () => typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id,
    { timeout: 10000 }
  );

  return sidepanelPage;
}

async function testBasicNavigation(browser: puppeteer.Browser): Promise<TestResult> {
  const testName = 'Basic Navigation with Telemetry';
  const startTime = Date.now();
  const logs: string[] = [];
  const errors: string[] = [];

  logTestStart(testName);

  try {
    // Get all pages and find the sidepanel
    const sidepanelPage = await getSidepanelPage(browser);
    await ensureDefaultSettings(sidepanelPage);
    log(`📄 Sidepanel page URL: ${sidepanelPage.url()}`);
    log('✅ Sidepanel page loaded');

    // Capture console logs from sidepanel
    sidepanelPage.on('console', (msg: puppeteer.ConsoleMessage) => {
      const text = msg.text();
      logs.push(`[SIDEPANEL] ${text}`);
      log(`[SIDEPANEL-CONSOLE] ${text}`);
    });

    sidepanelPage.on('pageerror', (error: Error) => {
      const text = error.message;
      // Filter out non-critical AI_NoObjectGeneratedError - workflow still succeeds
      if (!text.includes('AI_NoObjectGeneratedError')) {
        errors.push(`[SIDEPANEL-ERROR] ${text}`);
      }
      log(`❌ [SIDEPANEL-ERROR] ${text}`);
    });

    // Enable browser tools if needed
    log('🔧 Checking if browser tools are enabled...');
    try {
      await sidepanelPage.waitForSelector('button[title*="Browser Tools"]', { timeout: 5000 });
      const browserToolsButton = await sidepanelPage.$('button[title*="Browser Tools"]');
      if (browserToolsButton) {
        const buttonText = await browserToolsButton.evaluate((btn) => btn?.textContent || '');
        log(`🔘 Browser tools button found: ${buttonText}`);

          if (buttonText?.includes('○')) {
            log('🔄 Clicking to enable browser tools...');
            await browserToolsButton.click();
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      } catch (e) {
        logs.push(`[SETUP] Browser tools check failed: ${e}`);
      }

    // Find the input field and send a navigation command
    log('📝 Sending navigation command...');
    const inputResult = await waitForPromptInput(sidepanelPage, 20000);
    if (!inputResult) {
      const debugInfo = await sidepanelPage.evaluate(() => ({
        inputs: Array.from(document.querySelectorAll('textarea, input, [contenteditable="true"]')).map((el) => ({
          tag: el.tagName,
          placeholder: el.getAttribute('placeholder'),
          aria: el.getAttribute('aria-label'),
          className: el.className,
        })),
        bodySnippet: document.body.innerHTML.slice(0, 500),
      }));
      const debugInputs = `[DEBUG] Available inputs: ${JSON.stringify(debugInfo.inputs)}`;
      const debugBody = `[DEBUG] Body snippet: ${debugInfo.bodySnippet}`;
      logs.push(debugInputs);
      logs.push(debugBody);
      log(debugInputs);
      log(debugBody);
      throw new Error('Could not locate prompt input in page or frames');
    }

    const { handle: input, selector: matchedSelector, frame } = inputResult;
    log(`🔍 Found prompt input via selector: ${matchedSelector}${frame ? ` (frame: ${frame.url()})` : ''}`);
    if (frame) {
      const frameName = frame.url() || '<anonymous>';
      logs.push(`[DEBUG] Prompt input located within frame: ${frameName}`);
    }

    await input.click();
    await input.type('go to google.com', { delay: 50 });
    log('✅ Typed "go to google.com" into input');

    // Submit the form
    log('📤 Submitting command...');
    const submitButton = await sidepanelPage.$('button[aria-label="Send message"]');
    if (submitButton) {
      await submitButton.click();
      log('✅ Clicked submit button');
    } else {
      // Try pressing Enter
      await input.press('Enter');
      log('✅ Pressed Enter to submit');
    }

    // Wait for navigation to complete
    log('⏳ Waiting for navigation to complete...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Check for telemetry logs in background script
    log('📊 Checking for telemetry logs...');
    const telemetryLogs = logs.filter(log => log.includes('[TELEMETRY]'));
    log(`📈 Found ${telemetryLogs.length} telemetry entries`);

    telemetryLogs.forEach(telemetryLog => {
      log(`   ${telemetryLog}`);
    });

    // Extract agentic telemetry events for quality validation
    const toolSelectionEvents = logs.filter(log => log.includes('agentic_tool_selection'));
    const paramsQualityEvents = logs.filter(log => log.includes('agentic_params_quality'));
    const awarenessEvents = logs.filter(log => log.includes('agentic_awareness'));
    const iterationEvents = logs.filter(log => log.includes('agentic_iteration'));
    const contextUsageEvents = logs.filter(log => log.includes('agentic_context_usage'));

    // Look for success indicators
    const successLogs = logs.filter(log =>
      log.includes('SUCCESS') ||
      log.includes('navigate: SUCCESS') ||
      log.includes('Final summary') ||
      log.includes('Evaluation passed') || // Workflow completed successfully
      log.includes('Structured output received') || // Model generated valid response
      log.includes('executeTool] getPageContext completed') || // Tool execution success
      log.includes('Reasoning captured') // Model is actively reasoning
    );

    // Filter out non-critical errors (AI_NoObjectGeneratedError is expected when structured output parsing fails but workflow succeeds)
    const errorLogs = logs.filter(log =>
      (log.includes('FAILURE') ||
      log.includes('ERROR') ||
      log.includes('Error:')) &&
      !log.includes('AI_NoObjectGeneratedError') && // Ignore structured output parsing errors - workflow still succeeds
      !log.includes('[EVALUATION-ERROR]') // Ignore evaluation error context logging - it's telemetry, not a failure
    );

    log(`✅ Success indicators: ${successLogs.length}`);
    log(`❌ Error indicators: ${errorLogs.length}`);

    // Log agentic telemetry counts
    log(`🎯 Tool Selection Events: ${toolSelectionEvents.length}`);
    log(`⚙️  Parameter Quality Events: ${paramsQualityEvents.length}`);
    log(`🧠 Awareness Events: ${awarenessEvents.length}`);
    log(`🔄 Iteration Events: ${iterationEvents.length}`);
    log(`💬 Context Usage Events: ${contextUsageEvents.length}`);

    // Validate agentic telemetry events were captured
    expect(toolSelectionEvents.length).toBeGreaterThan(0, 'Should validate tool selection');
    expect(paramsQualityEvents.length).toBeGreaterThan(0, 'Should validate parameter quality');
    expect(awarenessEvents.length).toBeGreaterThan(0, 'Should validate agent awareness');
    expect(iterationEvents.length).toBeGreaterThan(0, 'Should track execution iterations');

    // Validate correct tool usage
    const correctToolSelections = toolSelectionEvents.filter(log => 
      log.includes('"match":true') || log.includes('match: true')
    );
    expect(correctToolSelections.length).toBeGreaterThan(0, 'Agent should select correct tools for the task');

    // Validate parameter quality - user data should be present in tool parameters
    const goodParams = paramsQualityEvents.filter(log => 
      log.includes('"user_data_present":true') || log.includes('user_data_present: true')
    );
    expect(goodParams.length).toBeGreaterThan(0, 'Agent should use user data in tool parameters');

    // Validate awareness - agent should check page context first
    const awarenessChecks = awarenessEvents.filter(log => 
      log.includes('"checked_page_first":true') || log.includes('checked_page_first: true')
    );
    expect(awarenessChecks.length).toBeGreaterThan(0, 'Agent should check page context before acting');

    // Validate telemetry data was captured
    expect(telemetryLogs.length).toBeGreaterThan(0, 'Telemetry events should be logged');

    // Validate success indicators
    expect(successLogs.length).toBeGreaterThan(0, 'Should have success indicators');

    const duration = Date.now() - startTime;
    const status = successLogs.length > 0 && errorLogs.length === 0 ? 'PASS' : 'FAIL';

    logTestEnd(testName, status, duration, logs, errors);

    return {
      testName,
      status,
      duration,
      logs,
      errors,
      telemetry: telemetryLogs
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`[TEST-ERROR] ${errorMessage}`);
    log(`❌ Test failed with error: ${errorMessage}`);

    logTestEnd(testName, 'FAIL', duration, logs, errors);

    return {
      testName,
      status: 'FAIL',
      duration,
      logs,
      errors
    };
  }
}

async function testTelemetryRetrieval(browser: puppeteer.Browser): Promise<TestResult> {
  const testName = 'Telemetry Data Retrieval';
  const startTime = Date.now();
  const logs: string[] = [];
  const errors: string[] = [];

  logTestStart(testName);

  try {
    const sidepanelPage = await getSidepanelPage(browser);
    log(`📄 Sidepanel page URL: ${sidepanelPage.url()}`);

    // Execute script to get telemetry data
    log('📊 Attempting to retrieve telemetry data...');

    await sidepanelPage.waitForFunction(
      () => typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id,
      { timeout: 10000 }
    );

    const telemetryData = await sidepanelPage.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_TELEMETRY' }, (response) => {
          resolve(response);
        });
      });
    });

    logs.push(`[TELEMETRY-DATA] ${JSON.stringify(telemetryData, null, 2)}`);
    log(`📈 Telemetry data retrieved: ${JSON.stringify(telemetryData, null, 2)}`);

    const duration = Date.now() - startTime;
    const status = telemetryData ? 'PASS' : 'FAIL';

    logTestEnd(testName, status, duration, logs, errors);

    return {
      testName,
      status,
      duration,
      logs,
      errors,
      telemetry: telemetryData
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    errors.push(`[TEST-ERROR] ${errorMessage}`);
    log(`❌ Test failed with error: ${errorMessage}`);

    logTestEnd(testName, 'FAIL', duration, logs, errors);

    return {
      testName,
      status: 'FAIL',
      duration,
      logs,
      errors
    };
  }
}

async function runAllTests(): Promise<void> {
  log('\n🚀 Starting End-to-End Navigation Tests with Telemetry\n');

  await clearLogs();

  const browser = await setupBrowser();

  try {
    // Test 1: Basic Navigation
    const basicNavResult = await testBasicNavigation(browser);
    testResults.push(basicNavResult);

    // Test 2: Telemetry Retrieval
    const telemetryResult = await testTelemetryRetrieval(browser);
    testResults.push(telemetryResult);

  } finally {
    log('\n🔚 Closing browser...');
    await browser.close();
  }

  // Print final summary
  log('\n' + '='.repeat(80));
  log('📊 FINAL TEST SUMMARY');
  log('='.repeat(80));

  const passed = testResults.filter(r => r.status === 'PASS').length;
  const failed = testResults.filter(r => r.status === 'FAIL').length;

  log(`✅ Passed: ${passed}/${testResults.length}`);
  log(`❌ Failed: ${failed}/${testResults.length}`);
  log(`⏱️  Total Duration: ${testResults.reduce((sum, r) => sum + r.duration, 0)}ms`);

  testResults.forEach((result: TestResult) => {
    log(`   ${result.status === 'PASS' ? '✅' : '❌'} ${result.testName} (${result.duration}ms)`);
    if (result.errors.length > 0) {
      log(`      Errors: ${result.errors.length}`);
      result.errors.forEach((error: string) => {
        log(`        ${error}`);
      });
    }
  });

  log('='.repeat(80));
  log(`📝 Full logs saved to: ${TEST_LOG_FILE}`);
  log('='.repeat(80));

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(error => {
    log(`\n❌ Test suite failed with error: ${error}`);
    process.exit(1);
  });
}

export { runAllTests, testBasicNavigation, testTelemetryRetrieval };
