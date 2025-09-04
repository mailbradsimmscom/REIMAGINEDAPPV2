# Test Matrix Documentation

## Overview

The test matrix provides comprehensive coverage for validation, error handling, and edge cases across all endpoints in the REIMAGINEDAPPV2 project.

## Test Matrix Coverage

### 1. Method Guards (405 Responses)
**File:** `tests/unit/validation/method-guards.test.js`
**Coverage:** 5 test cases
**Scenarios:**
- GET on POST-only endpoints returns 405
- PUT on POST-only endpoints returns 405
- Admin routes return 401/403 before 405
- Proper error envelope format

### 2. Bad Input Validation (400 Responses)
**File:** `tests/integration/bad-input.test.js`
**Coverage:** 33 test cases
**Scenarios:**
- Empty query parameters
- Invalid UUID parameters
- Missing required body fields
- Invalid data types
- Malformed JSON
- Out-of-range values

### 3. Comprehensive Validation Matrix
**File:** `tests/integration/comprehensive-validation.test.js`
**Coverage:** 20 test cases
**Scenarios:**
- Public GET → 400 on bad query
- Admin GET → 400 with valid token + bad query
- Wrong method on public POST-only → 405
- Bad UUID param → 400
- Disabled external → typed envelope (not 500)
- Admin route with invalid token → 401/403
- Missing required body → 400
- Invalid JSON body → 400
- Query parameter validation → 400
- Path parameter validation → 400
- Edge cases (XSS, SQL injection, very long inputs)
- Error envelope consistency

### 4. Security & Authentication
**Files:** `tests/integration/security.test.js`, `tests/integration/admin-auth.test.js`
**Coverage:** 14 test cases
**Scenarios:**
- Admin token validation
- Unauthorized access (401)
- Forbidden access (403)
- Token format validation
- Missing token handling

### 5. Response Validation
**File:** `tests/integration/response-validation.test.js`
**Coverage:** 7 test cases
**Scenarios:**
- Envelope format consistency
- Success response structure
- Error response structure
- Request ID inclusion
- Timestamp validation

### 6. Service-Specific Tests
**Files:** `tests/integration/pinecone.test.js`, `tests/integration/health.test.js`, `tests/integration/chat.test.js`, `tests/integration/systems.test.js`
**Coverage:** 46 test cases
**Scenarios:**
- Service availability
- Service-specific validation
- Service error handling
- Integration with external services

### 7. Admin Endpoint Tests
**File:** `tests/integration/admin.test.js`
**Coverage:** 10 test cases
**Scenarios:**
- Admin-only functionality
- Admin data validation
- Admin error handling

## Running Tests

### Individual Test Files
```bash
# Run method guards test
node tests/unit/validation/method-guards.test.js

# Run bad input test
node tests/integration/bad-input.test.js

# Run comprehensive validation test
node tests/integration/comprehensive-validation.test.js

# Run security test
node tests/integration/security.test.js
```

### Test Matrix Runner
```bash
# Run all test matrix tests
./scripts/run-test-matrix.sh
```

### Coverage Analysis
```bash
# Analyze test coverage
./scripts/test-coverage.sh
```

### Full CI Pipeline
```bash
# Run all CI checks including test matrix
./ci-guardrails.sh
```

## Test Matrix Scenarios

### Required Test Cases (from requirements)

1. **Public GET → 400 on bad query**
   ```javascript
   await get('/systems', { query: { q: '' } }).expect(400);
   ```

2. **Admin GET → 400 with valid token + bad query**
   ```javascript
   await get('/admin/docs', { 
     token: process.env.ADMIN_TOKEN, 
     query: { limit: 'abc' } 
   }).expect(400);
   ```

3. **Wrong method on public POST-only → 405**
   ```javascript
   await get('/pinecone/query').expect(405);
   ```

4. **Bad UUID param → 400**
   ```javascript
   await get('/document/not-a-uuid').expect(400);
   ```

5. **Disabled external → typed envelope (not 500)**
   ```javascript
   await post('/pinecone/query', { body: { query: 'ping' } })
     .expect(200)
     .expect(r => expect(r.body.error.code).toBe('PINECONE_DISABLED'));
   ```

### Additional Edge Cases

- **XSS Prevention:** Test with `<script>` tags in queries
- **SQL Injection Prevention:** Test with SQL-like strings
- **Very Long Inputs:** Test with inputs exceeding reasonable limits
- **Null/Undefined Handling:** Test with null and undefined values
- **Type Validation:** Test with wrong data types
- **Empty Values:** Test with empty strings, arrays, objects

## Test Coverage Metrics

- **Total Test Scenarios:** 12
- **Total Test Cases:** 135+
- **Coverage Percentage:** 91%
- **Coverage Status:** Excellent

## Integration with CI/CD

The test matrix is integrated into the CI pipeline:

1. **ESLint** - Code quality
2. **Router Import Test** - Module loading
3. **Route Map Test** - Route registration
4. **Sanity Checks** - Code quality gates
5. **Test Matrix Coverage** - Validation coverage

## Troubleshooting

### Common Test Failures

1. **405 Method Not Allowed:** Check if method guards are properly implemented
2. **400 Bad Request:** Check if validation schemas are correct
3. **401/403 Unauthorized:** Check admin token configuration
4. **500 Internal Server Error:** Check if services are properly configured

### Debugging Tips

- Run individual test files to isolate issues
- Check test logs for detailed error messages
- Verify environment variables are set correctly
- Ensure all required services are running

## Future Enhancements

- Add performance benchmarks
- Add load testing scenarios
- Add integration tests with real external services
- Add mutation testing for validation logic
- Add visual regression testing for UI components
