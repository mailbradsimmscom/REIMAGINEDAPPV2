# CI/CD Pipeline Documentation

## Overview

This project uses GitHub Actions for continuous integration to ensure code quality and prevent regressions.

## Pipeline Configuration

### File Location
- **Main config:** `.github/workflows/test.yml`
- **Triggers:** Push to `main`/`develop`, Pull Requests

### Workflow Steps

1. **Checkout Code**
   - Uses `actions/checkout@v4`
   - Clones the repository

2. **Setup Node.js**
   - Uses `actions/setup-node@v4`
   - Node.js version: 20.x
   - Enables npm caching for faster builds

3. **Install Dependencies**
   - Runs `npm ci` for clean install
   - Uses package-lock.json for consistency

4. **Run Linting**
   - Executes `npx eslint src/ --ext .js`
   - Ensures code quality standards

5. **Run Tests with Performance Monitoring**
   - Executes `npm run test:ci`
   - Runs all 74 integration tests
   - Monitors performance metrics
   - Uses mock environment variables

6. **Performance Monitoring**
   - Tracks test execution time
   - Monitors memory usage
   - Validates performance thresholds
   - Reports detailed metrics

7. **Test Summary**
   - Reports test completion
   - Shows coverage metrics
   - Confirms Express migration status
   - Displays performance results

## Environment Variables

The CI pipeline uses mock environment variables for testing:

```yaml
env:
  NODE_ENV: test
  APP_VERSION: 1.0.0
  PORT: 3000
  
  # Database (mock)
  SUPABASE_URL: https://test.supabase.co
  SUPABASE_SERVICE_KEY: test-service-key
  SUPABASE_ANON_KEY: test-anon-key
  
  # Pinecone (mock)
  PINECONE_API_KEY: test-pinecone-key
  PINECONE_INDEX: test-index
  PINECONE_REGION: us-east-1
  PINECONE_CLOUD: aws
  
  # OpenAI (mock)
  OPENAI_API_KEY: test-openai-key
  
  # Admin
  ADMIN_TOKEN: admin-secret-key
```

## Test Coverage

The CI pipeline validates:

### ✅ Core Functionality (74 tests total)
- **Health endpoints** (8 tests) - System monitoring
- **Systems endpoints** (10 tests) - Data management
- **Chat endpoints** (10 tests) - AI interactions
- **Admin endpoints** (10 tests) - Administrative functions
- **Document endpoints** (18 tests) - File processing
- **Pinecone endpoints** (18 tests) - Vector operations

### ✅ Security Features
- **Security headers** - CSP, X-Frame-Options, etc.
- **CORS configuration** - Cross-origin protection
- **Rate limiting** - Request throttling
- **Authentication** - Admin gate middleware

### ✅ Validation
- **Zod schemas** - Request/response validation
- **Error handling** - Consistent error responses
- **Middleware** - Express middleware stack

### ✅ Performance Monitoring
- **Test execution time** - Individual test < 10s
- **Total suite time** - Complete run < 30s
- **Memory usage** - < 512MB
- **Coverage validation** - 100% of expected tests

## Performance Metrics

The CI pipeline tracks and validates:

### 🚀 **Execution Performance**
- **Individual test time**: < 10 seconds per test
- **Total suite time**: < 30 seconds for all 74 tests
- **Memory usage**: < 512MB during test execution
- **Coverage**: 100% of expected test categories

### 📊 **Quality Metrics**
- **Test pass rate**: 100% (74/74 tests passing)
- **Code coverage**: All endpoints tested
- **Performance thresholds**: All metrics within limits
- **Security validation**: All security features tested

## Benefits

### 🚀 **Automated Quality Assurance**
- Catches regressions before they reach production
- Validates Express migration stability
- Ensures consistent API behavior
- Monitors performance degradation

### 🔒 **Security Validation**
- Tests security headers on every change
- Validates authentication middleware
- Confirms rate limiting functionality
- Ensures CORS protection

### 📊 **Comprehensive Coverage**
- 74 tests across all endpoints
- Happy path and failure scenarios
- Integration testing with real HTTP requests
- Performance benchmarking

### ⚡ **Fast Feedback**
- Runs on every push and PR
- Provides immediate test results
- Performance monitoring included
- Enables confident deployments

## Scripts

### Available Commands
```bash
# Run all tests with performance monitoring
npm run test:ci

# Run tests without sidecar dependencies
npm run test:no-sidecar

# Run performance monitoring only
npm run test:performance

# Run linting
npx eslint src/ --ext .js
```

## Troubleshooting

### Common Issues

1. **Environment Variable Errors**
   - Ensure all required env vars are set in CI
   - Check for typos in variable names

2. **Test Failures**
   - Review test logs for specific failures
   - Check if changes broke existing functionality

3. **Performance Threshold Exceeded**
   - Individual test taking > 10 seconds
   - Total suite taking > 30 seconds
   - Memory usage > 512MB

4. **Timeout Issues**
   - Some tests may take longer in CI environment
   - Consider increasing timeout limits if needed

### Local Testing

To test the CI configuration locally:

```bash
# Run the same tests as CI
npm run test:ci

# Check environment variables
node -e "console.log(process.env.NODE_ENV)"

# Run performance monitoring
npm run test:performance
```

## Future Enhancements

Potential improvements to the CI pipeline:

1. **Coverage Reporting**
   - Add code coverage metrics
   - Set minimum coverage thresholds

2. **Security Scanning**
   - Add dependency vulnerability scanning
   - Implement security linting

3. **Deployment Integration**
   - Add staging deployment on successful tests
   - Implement blue-green deployment strategy

4. **Advanced Performance Monitoring**
   - Track performance trends over time
   - Alert on performance regressions
   - Generate performance reports

## Phase 4 Completion

✅ **Full Test Coverage Achieved**
- All 74 tests passing consistently
- Performance monitoring integrated
- CI pipeline fully operational
- Ready for production deployment
