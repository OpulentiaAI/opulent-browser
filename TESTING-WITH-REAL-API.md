# Testing with Real API Keys

This guide explains how to get actual model responses instead of fallback summaries during testing.

## Quick Start

### Option 1: Using OpenRouter (Recommended - Free Tier Available)

1. **Get an API key** from [OpenRouter](https://openrouter.ai/keys)
   - Free tier available with `google/gemini-2.0-flash-exp:free` model
   - No credit card required for free models

2. **Set the environment variable**:
   ```bash
   export OPENROUTER_API_KEY='sk-or-v1-your-key-here'
   ```

3. **Run the tests**:
   ```bash
   ./run-e2e-with-api.sh
   ```

### Option 2: Using AI Gateway

1. **Get your AI Gateway API key**

2. **Set the environment variable**:
   ```bash
   export AI_GATEWAY_API_KEY='your-gateway-key'
   ```

3. **Run the tests**:
   ```bash
   ./run-e2e-with-api.sh
   ```

### Option 3: Using .env.local File

1. **Edit `.env.local`** (already created for you):
   ```bash
   # Choose one:
   OPENROUTER_API_KEY=sk-or-v1-your-key-here
   # OR
   AI_GATEWAY_API_KEY=your-gateway-key
   ```

2. **Run the tests**:
   ```bash
   ./run-e2e-with-api.sh
   ```

## What Changes?

### Without API Key (Current Behavior)
- ❌ HTTP 401 error from API
- ✅ Fallback summary generated
- ⚠️ Tests pass but don't exercise real AI responses

### With Valid API Key
- ✅ Real model generates execution plan
- ✅ Actual streaming responses
- ✅ Full workflow telemetry captured
- ✅ Tests verify end-to-end AI integration

## Supported Providers

| Provider | Environment Variable | Model | Cost |
|----------|---------------------|-------|------|
| **OpenRouter** | `OPENROUTER_API_KEY` | `google/gemini-2.0-flash-exp:free` | Free |
| AI Gateway | `AI_GATEWAY_API_KEY` | `google/gemini-2.5-flash` | Varies |
| Google AI | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.5-flash` | Pay-per-use |
| NVIDIA NIM | `NVIDIA_API_KEY` | Various | Varies |

## Test Script Features

The `run-e2e-with-api.sh` script:
- ✅ Auto-loads `.env.local` if present
- ✅ Detects which API key is available
- ✅ Configures the correct provider automatically
- ✅ Shows which key is being used (first 10 chars)
- ✅ Falls back gracefully if no key found

## Manual Testing

You can also run tests manually:

```bash
# With OpenRouter
OPENROUTER_API_KEY='sk-or-v1-...' NODE_ENV=production ./node_modules/.bin/tsx --eval "import('./tests/e2e-navigation.test.ts').then(m => m.runAllTests());"

# With AI Gateway
AI_GATEWAY_API_KEY='your-key' NODE_ENV=production ./node_modules/.bin/tsx --eval "import('./tests/e2e-navigation.test.ts').then(m => m.runAllTests());"
```

## Testing in the Browser Extension

To test with real API keys in the Chrome extension:

1. **Load the extension** in Chrome (`chrome://extensions/`)
2. **Open the sidepanel**
3. **Click Settings** (gear icon)
4. **Enter your API key** and select provider
5. **Save** - settings persist in Chrome's local storage

## Troubleshooting

### Still Getting 401 Errors?

1. **Check your API key is valid**:
   ```bash
   echo $OPENROUTER_API_KEY
   ```

2. **Verify the key format**:
   - OpenRouter: `sk-or-v1-...`
   - Should be ~60+ characters

3. **Check the logs**:
   ```bash
   cat tests/e2e-test-logs.txt | grep "API key"
   ```

### Tests Pass But No Real Response?

Check the test logs for:
```
✅ Using openrouter API key from environment: sk-or-v1-...
```

If you see:
```
⚠️ No API key found in environment. Using placeholder key (will trigger fallback).
```

Then the environment variable isn't being picked up.

## Next Steps

Once you have real API responses working:
1. Verify the full workflow execution in logs
2. Check telemetry data is captured correctly
3. Test different models and providers
4. Benchmark performance with real AI calls

## Security Notes

- ⚠️ Never commit `.env.local` to git (already in `.gitignore`)
- ⚠️ Don't share API keys in logs or screenshots
- ✅ Use environment variables for CI/CD
- ✅ Rotate keys if accidentally exposed
