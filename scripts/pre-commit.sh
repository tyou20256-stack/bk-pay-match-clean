#!/bin/bash
echo "Running pre-commit checks..."
npx eslint src/ --max-warnings 20 || exit 1
npx tsc --noEmit || exit 1
echo "Pre-commit checks passed"
