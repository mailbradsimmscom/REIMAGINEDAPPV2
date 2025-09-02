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

4. **Run Tests**
   - Executes `npm test`
   - Uses mock environment variables
   - Validates all 59 integration tests

5. **Test Summary**
   - Reports test completion
   - Shows coverage metrics
   - Confirms Express migration status

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

### ✅ Core Functionality
- **Health endpoints** - System monitoring
- **Systems endpoints** - Data management
- **Chat endpoints** - AI interactions
- **Admin endpoints** - Administrative functions
- **Document endpoints** - File processing
- **Pinecone endpoints** - Vector operations

### ✅ Security Features
- **Security headers** - CSP, X-Frame-Options, etc.
- **CORS configuration** - Cross-origin protection
- **Rate limiting** - Request throttling
- **Authentication** - Admin gate middleware

### ✅ Validation
- **Zod schemas** - Request/response validation
- **Error handling** - Consistent error responses
- **Middleware** - Express middleware stack

## Benefits

### 🚀 **Automated Quality Assurance**
- Catches regressions before they reach production
- Validates Express migration stability
- Ensures consistent API behavior

### 🔒 **Security Validation**
- Tests security headers on every change
- Validates authentication middleware
- Confirms rate limiting functionality

### 📊 **Comprehensive Coverage**
- 59 tests across all endpoints
- Happy path and failure scenarios
- Integration testing with real HTTP requests

### ⚡ **Fast Feedback**
- Runs on every push and PR
- Provides immediate test results
- Enables confident deployments

## Troubleshooting

### Common Issues

1. **Environment Variable Errors**
   - Ensure all required env vars are set in CI
   - Check for typos in variable names

2. **Test Failures**
   - Review test logs for specific failures
   - Check if changes broke existing functionality

3. **Timeout Issues**
   - Some tests may take longer in CI environment
   - Consider increasing timeout limits if needed

### Local Testing

To test the CI configuration locally:

```bash
# Run the same tests as CI
npm test

# Check environment variables
node -e "console.log(process.env.NODE_ENV)"
```

## Future Enhancements

Potential improvements to the CI pipeline:

1. **Coverage Reporting**
   - Add code coverage metrics
   - Set minimum coverage thresholds

2. **Performance Testing**
   - Add performance benchmarks
   - Monitor response times

3. **Security Scanning**
   - Add dependency vulnerability scanning
   - Implement security linting

4. **Deployment Integration**
   - Add staging deployment on successful tests
   - Implement blue-green deployment strategy
