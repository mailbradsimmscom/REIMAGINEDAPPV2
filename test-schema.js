import { z } from 'zod';

// Test the schema directly
const systemsSearchQuerySchema = z.object({
  q: z.string().min(2, 'Query must be at least 2 characters').max(100, 'Query too long'),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).passthrough();

console.log('Testing schema directly:');
const testData = { q: 'a' };
const result = systemsSearchQuerySchema.safeParse(testData);
console.log('Result:', result);
if (!result.success) {
  console.log('Errors:', result.error.errors);
}
