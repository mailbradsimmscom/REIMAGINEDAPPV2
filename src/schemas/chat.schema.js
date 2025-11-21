import { z } from 'zod';
import { paginationQuerySchema } from './common.schema.js';
import { EnvelopeSuccessSchema, EnvelopeErrorSchema } from './envelope.schema.js';

// Shared error envelope schema
const ErrorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.any().optional()
  })
});

// Chat history query parameters
export const chatHistoryQuerySchema = z.object({
  threadId: z.string().min(1, 'threadId is required'),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});

// Chat history success response schema
const ChatHistoryOkSchema = z.object({
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

// Discriminated union for chat history endpoint
export const chatHistoryResponseSchema = z.union([ChatHistoryOkSchema, ErrorEnvelopeSchema]);

// Fast chat request schema (for two-call mode)
export const fastChatRequestSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty'),
  threadId: z.string(),
  sessionId: z.string(),
  sequenceNumber: z.number().int().positive(),
  synthesisModel: z.string().optional().default('gpt-5')
});

// Fast chat response schema
const FastChatOkSchema = z.object({
  success: z.literal(true),
  data: z.object({
    userMessage: z.object({
      id: z.string(),
      content: z.string(),
      role: z.literal('user'),
      sequenceNumber: z.number(),
      createdAt: z.string()
    }),
    assistantMessage: z.object({
      id: z.string(),
      content: z.string(),
      role: z.literal('assistant'),
      sequenceNumber: z.number(),
      createdAt: z.string(),
      isComplete: z.boolean()
    }),
    cachedState: z.object({
      userQuery: z.string(),
      systemsContext: z.array(z.any()),
      classification: z.object({
        category: z.string().optional(),
        confidence: z.number().optional()
      }).optional(),
      pineconeResults: z.object({
        matches: z.array(z.object({
          text: z.string(),
          score: z.number(),
          docType: z.string().optional(),
          manufacturer: z.string().optional(),
          model: z.string().optional()
        }))
      }).optional(),
      conversationSummary: z.string().optional()
    }).optional()
  })
});

export const fastChatResponseSchema = z.union([FastChatOkSchema, ErrorEnvelopeSchema]);

// Web enrichment request schema
export const webEnrichRequestSchema = z.object({
  threadId: z.string(),
  sequenceNumber: z.number().int().positive(),
  messageId: z.string(),
  cachedState: z.object({
    userQuery: z.string(),
    systemsContext: z.array(z.any()).optional(),
    classification: z.any().optional(),
    pineconeResults: z.any().optional(),
    conversationSummary: z.string().optional()
  })
});

// Web enrichment response schema
const WebEnrichOkSchema = z.object({
  success: z.literal(true),
  data: z.object({
    messageId: z.string(),
    enrichedContent: z.string(),
    webSources: z.array(z.object({
      url: z.string(),
      title: z.string().optional(),
      snippet: z.string().optional()
    })).optional(),
    isComplete: z.literal(true)
  })
});

export const webEnrichResponseSchema = z.union([WebEnrichOkSchema, ErrorEnvelopeSchema]);

// Chat delete request schema
export const chatDeleteRequestSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required')
});

// Chat delete success response schema
const ChatDeleteOkSchema = z.object({
  success: z.literal(true),
  data: z.object({
    sessionId: z.string(),
    deleted: z.literal(true)
  }),
  timestamp: z.string()
});

// Discriminated union for chat delete endpoint
export const chatDeleteResponseSchema = z.union([ChatDeleteOkSchema, ErrorEnvelopeSchema]);

// Chat list query parameters
export const chatListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional()
});

// Chat process request schema
export const chatProcessRequestSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty').optional(),
  query: z.string().min(1, 'Query cannot be empty').optional(),
  sessionId: z.string().optional(),
  threadId: z.string().optional(),
  thread_id: z.string().optional()
}).refine(data => data.message || data.query, {
  message: 'Either message or query is required'
});

// Chat process success response schema
const ChatProcessOkSchema = z.object({
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
    sources: z.array(z.any()).optional(),
    telemetry: z.object({
      requestId: z.string().optional(),
      retrievalMeta: z.object({
        specBiasMeta: z.any().optional(),
        styleDetected: z.string().optional(),
        temperature: z.number().optional(),
        model: z.string().optional()
      }).optional()
    }).optional()
  }),
  timestamp: z.string()
});

// Discriminated union for chat process endpoint
export const chatProcessResponseSchema = z.union([ChatProcessOkSchema, ErrorEnvelopeSchema]);

// Chat list success response schema
const ChatListOkSchema = z.object({
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
    nextCursor: z.string().nullable().optional()
  }),
  timestamp: z.string()
});

// Discriminated union for chat list endpoint
export const chatListResponseSchema = z.union([ChatListOkSchema, ErrorEnvelopeSchema]);

// Chat context query parameters
export const chatContextQuerySchema = z.object({
  threadId: z.string().min(1, 'threadId is required')
});

// Chat context success response schema
const ChatContextOkSchema = z.object({
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

// Discriminated union for chat context endpoint
export const chatContextResponseSchema = z.union([ChatContextOkSchema, ErrorEnvelopeSchema]);

// Chat delete by path parameter
export const chatDeletePathSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required')
});

// Tightened delete response data schemas
const DeleteResponseData = z.object({
  sessionId: z.string(),
  deleted: z.literal(true)
}).passthrough();

// Delete operation envelope schemas
export const ChatDeleteEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: DeleteResponseData }),
  EnvelopeErrorSchema
]);

// Tightened chat history response data schema
const ChatHistoryData = z.object({
  threadId: z.string(),
  messages: z.array(z.object({
    id: z.string(),
    content: z.string(),
    role: z.enum(['system', 'user', 'assistant']),
    createdAt: z.string(),
    metadata: z.record(z.string(), z.any()).optional()
  })),
  count: z.number()
});

// Chat history envelope schema
export const ChatHistoryEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: ChatHistoryData }),
  EnvelopeErrorSchema
]);

// Tightened chat context response data schema
const ChatContextData = z.object({
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
    role: z.enum(['system', 'user', 'assistant']),
    createdAt: z.string(),
    metadata: z.record(z.string(), z.any()).optional()
  })),
  context: z.any()
});

// Chat context envelope schema
export const ChatContextEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: ChatContextData }),
  EnvelopeErrorSchema
]);

// Chat process envelope schema
const ChatProcessData = z.object({
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
});

export const ChatProcessEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: ChatProcessData }),
  EnvelopeErrorSchema
]);

// Chat list envelope schema
const ChatListData = z.object({
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
  nextCursor: z.string().nullable().optional()
});

export const ChatListEnvelope = z.union([
  EnvelopeSuccessSchema.extend({ data: ChatListData }),
  EnvelopeErrorSchema
]);
