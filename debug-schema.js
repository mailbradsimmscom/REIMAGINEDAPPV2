// Debug script to test schema validation
import { z } from 'zod';

// Recreate the schema locally
const systemsSearchQuerySchema = z.object({
  q: z.string().min(2, 'Query must be at least 2 characters').max(100, 'Query too long'),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).passthrough();

// Test the schema directly
console.log('Testing schema directly:');
const testData = { q: 'test' };
const result = systemsSearchQuerySchema.safeParse(testData);
console.log('Result:', result);

// Test empty query
console.log('\nTesting empty query:');
const emptyResult = systemsSearchQuerySchema.safeParse({});
console.log('Empty result:', emptyResult);

// Test with missing q
console.log('\nTesting missing q:');
const missingResult = systemsSearchQuerySchema.safeParse({ limit: 10 });
console.log('Missing q result:', missingResult);

// Test with short query
console.log('\nTesting short query:');
const shortResult = systemsSearchQuerySchema.safeParse({ q: 'a' });
console.log('Short result:', shortResult);
