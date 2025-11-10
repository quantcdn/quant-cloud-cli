# CLI Tests

Test suite for the Quant Cloud CLI using the mock API backend.

## Overview

Tests are split into two categories:

- **Unit tests**: Fast, isolated tests that don't require external services
- **Integration tests**: Tests that interact with the mock API via Docker

## Running Tests

### Quick Start

```bash
# Run unit tests only (fast, no Docker required)
npm test
# or
make test

# Run integration tests (requires Docker)
npm run test:integration
# or
make test-integration

# Run all tests
npm run test:all
# or
make test-all
```

### Manual Mock API Testing

Start the mock API manually to test CLI commands:

```bash
# Start mock API
make mock-api-start

# Test with CLI (in another terminal)
export QUANT_HOST=http://localhost:4010
export QUANT_TOKEN=mock-token-123
qc app list

# Stop mock API
make mock-api-stop
```

## Test Structure

```
__tests__/
├── setup/
│   ├── globalSetup.ts      # Start Docker before tests
│   └── globalTeardown.ts   # Stop Docker after tests
├── integration/
│   └── api.integration.test.ts  # Integration tests
└── utils/
    ├── api.test.ts         # Unit tests
    ├── config.test.ts
    ├── logger.test.ts
    └── project-config.test.ts
```

## Integration Tests

Integration tests use the published mock API container:
- **Image**: `ghcr.io/quantcdn/quant-mock-api:4.0.0`
- **Port**: 4010
- **Auto-managed**: Docker container starts/stops automatically

### How It Works

1. Jest global setup starts Docker container
2. Tests run against `http://localhost:4010`
3. Jest global teardown stops and removes container

### Requirements

- Docker installed and running
- Port 4010 available
- Internet connection (first run downloads image)

## Configuration

### Jest Configs

- `jest.config.js`: Unit tests (integration tests excluded)
- `jest.config.integration.js`: Integration tests only

### Environment Variables

Integration tests respect:
- `MOCK_API_URL`: Override mock API endpoint (default: `http://localhost:4010`)

## CI/CD

GitHub Actions runs tests automatically:

- **Unit tests**: Run on every push/PR (fast)
- **Integration tests**: Run on every push/PR (uses GitHub services)
- **Separate jobs**: Failures in one don't block the other

See `.github/workflows/test.yml` for details.

## Writing Tests

### Unit Test Example

```typescript
import { describe, it, expect } from '@jest/globals';
import { MyModule } from '../../src/utils/my-module.js';

describe('MyModule', () => {
  it('should do something', () => {
    const result = MyModule.doSomething();
    expect(result).toBe('expected');
  });
});
```

### Integration Test Example

```typescript
import { describe, it, expect } from '@jest/globals';
import { ApiClient } from '../../src/utils/api.js';

const MOCK_API_URL = process.env.MOCK_API_URL || 'http://localhost:4010';

describe('API Integration', () => {
  it('should call mock API', async () => {
    const client = new ApiClient(MOCK_API_URL, 'mock-token', 'test-org');
    const apps = await client.getApplications();
    expect(apps).toBeDefined();
  });
});
```

## Troubleshooting

### Docker Issues

```bash
# Check if mock API is running
docker ps | grep quant-mock-api

# View logs
make mock-api-logs

# Force restart
make mock-api-stop
make mock-api-start
```

### Port Already in Use

```bash
# Find what's using port 4010
lsof -i :4010

# Kill the process or change the port in docker-compose.test.yml
```

### Tests Timeout

Integration tests have a 30s timeout. If they fail:

1. Check Docker is running
2. Check internet connection (for image pull)
3. Check mock API logs: `make mock-api-logs`
4. Try manually: `make mock-api-start`

### Mock API Not Responding

```bash
# Test manually
curl http://localhost:4010/api/v3/organisations/test/applications

# If it fails, check health
docker inspect quant-mock-api-test --format='{{.State.Health.Status}}'
```

## Mock API Details

The mock API is built with [Prism](https://stoplight.io/open-source/prism) and auto-generates responses from the OpenAPI spec.

### Features

✅ Automatic response generation  
✅ Request validation  
✅ Path parameter handling  
✅ CORS enabled  
✅ No manual mocking needed  

### Example Endpoints

```bash
# List applications
GET /api/v3/organisations/{org}/applications

# List environments  
GET /api/v3/organisations/{org}/applications/{app}/environments
```

See `testing-infrastructure/openapi.yaml` for full API spec.

## Coverage

Generate coverage reports:

```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

## Resources

- [Mock API Documentation](../testing-infrastructure/README.md)
- [OpenAPI Spec](../testing-infrastructure/openapi.yaml)
- [Jest Documentation](https://jestjs.io/)
- [Prism Documentation](https://docs.stoplight.io/docs/prism)

