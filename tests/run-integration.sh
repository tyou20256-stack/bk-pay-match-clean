#!/bin/bash
echo "=== BK Pay Integration Tests ==="
echo "Checking servers..."
curl -sf http://localhost:3003/api/status > /dev/null && echo "✓ BK Pay (3003)" || echo "✗ BK Pay not running"
curl -sf http://localhost:3002/api/accounts > /dev/null 2>&1 && echo "✓ Account Router (3002)" || echo "⊘ Account Router not running (some tests will skip)"
echo ""
npx vitest run tests/integration.test.ts
