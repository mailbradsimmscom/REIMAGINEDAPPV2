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
      metadata: z.record(z.string(), z.any()).optional()
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

// Chat process response schema
export const chatProcessResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    sessionId: z.string(),
    threadId: z.string(),
    userMessage: z.object({
      id: z.string(),
      content: z.string(),
      role: z.string(),
      createdAt: z.string()
    }),
    assistantMessage: z.object({
      id: z.string(),
      content: z.string(),
      role: z.string(),
      createdAt: z.string(),
      sources: z.array(z.any()).optional()
    }),
    systemsContext: z.array(z.any()).optional(),
    enhancedQuery: z.string().optional(),
    sources: z.array(z.any()).optional()
  }),
  timestamp: z.string()
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
        metadata: z.record(z.string(), z.any()).optional()
      }).optional()
    })),
    count: z.number(),
    nextCursor: z.string().optional()
  }),
  timestamp: z.string()
});

// Chat context query parameters
export const chatContextQuerySchema = z.object({
  threadId: z.string().min(1, 'threadId is required')
});

// Chat context response schema
export const chatContextResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    session: z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      createdAt: z.string(),
      updatedAt: z.string()
    }),
    thread: z.object({
      id: z.string(),
      name: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
      metadata: z.record(z.string(), z.any()).optional()
    }),
    messages: z.array(z.object({
      id: z.string(),
      content: z.string(),
      role: z.string(),
      createdAt: z.string(),
      metadata: z.record(z.string(), z.any()).optional()
    })),
    context: z.any()
  }),
  timestamp: z.string()
});

// Chat delete by path parameter
export const chatDeletePathSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required')
});

// Chat error response schema
export const chatErrorSchema = z.object({
  success: z.literal(false),
  error: z.string()
});
