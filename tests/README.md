# Port of Call Test Suite

Comprehensive integration tests for all FTP, SSH, and TCP protocols.

## Quick Start

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run tests in watch mode (auto-rerun on changes)
npm run test:watch

# Run tests with UI dashboard
npm run test:ui
```

## Test Organization

### FTP Tests (`ftp.test.ts`)
Tests all FTP operations against public test server (`ftp.dlptest.com`):
- ✅ Connect & authenticate
- ✅ List directory contents
- ✅ Upload files (STOR)
- ✅ Download files (RETR)
- ✅ Rename files (RNFR/RNTO)
- ✅ Delete files (DELE)
- ✅ Create directories (MKD)
- ✅ Error handling & validation

### SSH Tests (`ssh.test.ts`)
Tests SSH connectivity checks against public test server (`test.rebex.net`):
- ✅ Connect & read SSH banner
- ✅ HTTP/JSON endpoint testing
- ✅ WebSocket tunnel info endpoints
- ✅ Error handling

### TCP Ping Tests (`tcp-ping.test.ts`)
Tests basic TCP connectivity:
- ✅ Ping various hosts and ports
- ✅ Measure round-trip time
- ✅ Error handling for unreachable hosts

## Running Specific Tests

```bash
# Run only FTP tests
npx vitest run tests/ftp.test.ts

# Run only SSH tests
npx vitest run tests/ssh.test.ts

# Run only TCP ping tests
npx vitest run tests/tcp-ping.test.ts
```

## Environment Variables

Override the API base URL for testing:

```bash
# Test against local development server
API_BASE=http://localhost:8787/api npm test

# Test against production
API_BASE=https://portofcall.ross.gg/api npm test
```

## Test Coverage

Generate coverage reports:

```bash
npx vitest run --coverage
```

Coverage reports are saved to `./coverage/`.

## Pre-commit Hooks

Tests run automatically on every commit via Husky pre-commit hooks:

1. **Type Check** - Ensures TypeScript compiles without errors
2. **Tests** - All integration tests must pass
3. **Build** - Project must build successfully

To bypass hooks (not recommended):
```bash
git commit --no-verify
```

## CI/CD Integration

These tests are designed to run in CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Install dependencies
  run: npm ci

- name: Run tests
  run: npm test
  env:
    API_BASE: https://portofcall.ross.gg/api
```

## Test Results

After running tests:
- **Console output**: Detailed pass/fail for each test
- **JSON results**: `./test-results/results.json`
- **HTML report**: `./test-results/index.html`

## Troubleshooting

### Tests timing out
- Default timeout is 60 seconds (configurable in `vitest.config.ts`)
- FTP operations can be slow on public test servers
- Check if test server is online

### Network errors
- Tests require internet connection to reach public test servers
- Firewall may block FTP (port 21) or SSH (port 22)
- VPN may interfere with connections

### Failed tests after code changes
- Ensure Worker is deployed: `npm run worker:deploy`
- Wait a few seconds for deployment to propagate
- Check Cloudflare Workers logs for errors

## Test Servers

### FTP Test Server
- **Host**: ftp.dlptest.com
- **Port**: 21
- **Username**: dlpuser@dlptest.com
- **Password**: SzMf7rTE4pCrf9dV286GuNe4N
- **Features**: Passive mode, read/write access

### SSH Test Server
- **Host**: test.rebex.net
- **Port**: 22
- **Username**: demo (for full sessions)
- **Password**: password (for full sessions)
- **Features**: SSH-2 protocol

## Adding New Tests

1. Create new test file in `tests/` directory
2. Follow naming convention: `*.test.ts`
3. Use Vitest/Chai assertions
4. Include descriptive test names
5. Test both success and error cases

Example:
```typescript
import { describe, it, expect } from 'vitest';

describe('New Feature', () => {
  it('should work correctly', async () => {
    const response = await fetch('...');
    expect(response.ok).toBe(true);
  });
});
```
