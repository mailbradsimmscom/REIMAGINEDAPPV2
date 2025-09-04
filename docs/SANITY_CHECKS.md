# Sanity Checks Documentation

## Overview

The sanity checks are automated quality gates that prevent common issues and ensure code quality in the REIMAGINEDAPPV2 project.

## Running Sanity Checks

```bash
# Run all sanity checks
./scripts/sanity-checks.sh

# Run as part of CI pipeline
./ci-guardrails.sh
```

## Checks Performed

### 1. Helper Function Validation
**Check:** No helpers awaiting internally (they should return a Request)
**Pattern:** `return await` in test helper functions
**Why:** Test helpers should return Supertest Request objects for chaining, not await them

### 2. Double-Send Prevention
**Check:** No `res.json(enforceResponse(...))` double-send
**Pattern:** `res.json.*enforceResponse` in source code
**Why:** Prevents "Cannot set headers after they are sent" errors

### 3. Validation Coverage
**Check:** Routes with query/params must have validate()
**Pattern:** GET/DELETE routes with query/params validation
**Why:** Ensures all input is properly validated

### 4. Log Error Monitoring
**Check:** No "Cannot set headers" errors in logs
**Pattern:** `Cannot set headers` in log files
**Why:** Catches runtime double-send issues

### 5. Validation Error Handling
**Check:** No stack traces for validation (should be 400 envelopes)
**Pattern:** `ValidationError` or `ZodError` in logs
**Why:** Validation errors should be handled as 400 responses, not 500

### 6. Method Guard Coverage
**Check:** Method guards are properly implemented
**Pattern:** POST routes without corresponding `router.all()` guards
**Why:** Ensures proper 405 responses for wrong HTTP methods

### 7. Admin Route Protection
**Check:** Admin routes are properly gated
**Pattern:** Admin routes with `adminGate` middleware
**Why:** Ensures admin endpoints are properly secured

## Integration with CI

The sanity checks are integrated into the CI pipeline via `ci-guardrails.sh`:

```bash
# 1. ESLint
# 2. Router Import Test  
# 3. Route Map Test
# 4. Sanity Checks  ← Added in Phase 2
```

## Bad-Input Test Matrix

A comprehensive test suite (`tests/integration/bad-input-matrix.test.js`) covers:

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

## Troubleshooting

### Common Issues

1. **"Cannot set headers" errors**: Check for double-send patterns in route handlers
2. **Missing method guards**: Add `router.all('/path', methodNotAllowed)` after POST handlers
3. **Validation stack traces**: Ensure validation errors are caught and returned as 400 envelopes
4. **Admin route issues**: Verify `adminGate` middleware is applied to all admin routes

### False Positives

- Some warnings are expected (e.g., POST routes that already have method guards)
- Log errors may be from previous runs (check timestamps)
- Validation errors in logs may be intentional (check context)

## Future Enhancements

- Add performance checks (response time thresholds)
- Add security checks (CORS, headers, etc.)
- Add dependency vulnerability scanning
- Add code coverage thresholds
