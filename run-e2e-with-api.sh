#!/bin/bash

# E2E Test Runner with API Key Support
# 
# Usage:
#   ./run-e2e-with-api.sh                    # Uses keys from .env.local if present
#   OPENROUTER_API_KEY=sk-xxx ./run-e2e-with-api.sh  # Pass key directly

set -e

echo "🧪 Running E2E Tests with API Key Support"
echo "=========================================="

# Load .env.local if it exists and no API key is set
if [ -f .env.local ] && [ -z "$OPENROUTER_API_KEY" ] && [ -z "$AI_GATEWAY_API_KEY" ]; then
  echo "📄 Loading environment from .env.local"
  set -a
  source .env.local
  set +a
fi

# Check for API keys
if [ -n "$OPENROUTER_API_KEY" ]; then
  echo "✅ Using OpenRouter API key: ${OPENROUTER_API_KEY:0:10}..."
  echo "   Provider: openrouter"
  echo "   Model: google/gemini-2.0-flash-exp:free"
elif [ -n "$AI_GATEWAY_API_KEY" ]; then
  echo "✅ Using AI Gateway API key: ${AI_GATEWAY_API_KEY:0:10}..."
  echo "   Provider: gateway"
  echo "   Model: google/gemini-2.5-flash"
else
  echo "⚠️  No API key found - tests will use fallback mode"
  echo ""
  echo "To get real model responses, set one of:"
  echo "  export OPENROUTER_API_KEY='sk-or-v1-...'"
  echo "  export AI_GATEWAY_API_KEY='your-key'"
  echo ""
  echo "Or add to .env.local file"
fi

echo ""
echo "🚀 Starting tests..."
echo ""

NODE_ENV=production ./node_modules/.bin/tsx --eval "import('./tests/e2e-navigation.test.ts').then(m => m.runAllTests());"

echo ""
echo "✅ Tests complete!"
