# Quick Start: Get Real Model Responses

## 🚀 Fastest Way (2 minutes)

### 1. Get a Free OpenRouter API Key

Visit: https://openrouter.ai/keys

- Click "Create Key"
- No credit card needed for free models
- Copy your key (starts with `sk-or-v1-`)

### 2. Set Your API Key

**Option A - Command Line:**
```bash
export OPENROUTER_API_KEY='sk-or-v1-paste-your-key-here'
```

**Option B - .env.local File:**
```bash
# Edit .env.local and replace:
OPENROUTER_API_KEY=sk-or-v1-paste-your-key-here
```

### 3. Run Tests

```bash
./run-e2e-with-api.sh
```

## ✅ What You'll See

**Before (no API key):**
```
Failed to load resource: the server responded with a status of 401 ()
⚠️ [WORKFLOW] Model returned no output, generating fallback summary
```

**After (with API key):**
```
✅ Using openrouter API key from environment: sk-or-v1-...
🔍 [PLANNING] Calling planning function
🔍 [STREAMING] Calling enhanced agent.stream()
✅ [Summarization] AI summarizer completed
```

## 📖 Full Documentation

See [TESTING-WITH-REAL-API.md](./TESTING-WITH-REAL-API.md) for:
- Alternative providers (AI Gateway, Google, NVIDIA)
- Browser extension testing
- Troubleshooting
- Security best practices

## 🔑 Recommended models

**For production-quality E2E tests:**
- `openai/gpt-4.1-mini` (default - excellent structured output, very affordable ~$0.15/1M tokens)

**Free tier alternatives (limited structured output support):**
- `google/gemini-2.0-flash-exp:free`
- `google/gemini-flash-1.5:free`
- `meta-llama/llama-3.2-3b-instruct:free`

Note: Free models may use fallback evaluation due to limited structured output support.
