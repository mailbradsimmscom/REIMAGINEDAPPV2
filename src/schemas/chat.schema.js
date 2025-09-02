import { z } from 'zod';
import { paginationSchema } from './common.schema.js';

// Chat history query parameters
export const chatHistoryQuerySchema = z.object({
  threadId: z.string().min(1, 'threadId is required'),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

// Chat history response schema
export const chatHistoryResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    threadId: z.string(),
    messages: z.array(z.object({
      id: z.string(),
      content: z.string(),
      role: z.string(),
      createdAt: z.string(),
      metadata: z.record(z.any()).optional()
    })),
    count: z.number()
  }),
  timestamp: z.string()
});

// Chat delete request schema
export const chatDeleteRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required')
});

// Chat delete response schema
export const chatDeleteResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    sessionId: z.string(),
    deleted: z.literal(true)
  }),
  timestamp: z.string()
});

// Chat list query parameters
export const chatListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional()
});

// Chat process request schema
export const chatProcessRequestSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty'),
  sessionId: z.string().optional(),
  threadId: z.string().optional()
});

// Chat list response schema
export const chatListResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    chats: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
      latestThread: z.object({
        id: z.string(),
        name: z.string(),
        createdAt: z.string(),
        updatedAt: z.string(),
        metadata: z.record(z.any()).optional()
      }).optional()
    })),
    count: z.number(),
    nextCursor: z.string().optional()
  }),
  timestamp: z.string()
});

// Chat error response schema
export const chatErrorSchema = z.object({
  success: z.literal(false),
  error: z.string()
});
