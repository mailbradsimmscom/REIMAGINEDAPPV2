// Central export file for all Zod schemas
// This provides a clean import interface: import { chatSchema, documentSchema } from '../schemas/index.js'

// Health schemas
export { healthQuerySchema } from './health.schema.js';

// Chat schemas  
export { 
  chatMessageSchema, 
  chatQuerySchema, 
  chatListQuerySchema, 
  chatListResponseSchema, 
  chatProcessRequestSchema,
  chatHistoryQuerySchema,
  chatHistoryResponseSchema,
  chatDeleteRequestSchema,
  chatDeleteResponseSchema,
  chatErrorSchema 
} from './chat.schema.js';

// Document schemas
export { 
  documentJobsQuerySchema,
  documentJobsResponseSchema,
  documentDocumentsQuerySchema,
  documentDocumentsResponseSchema,
  documentGetQuerySchema,
  documentGetResponseSchema,
  documentErrorSchema
} from './document.schema.js';

// Systems schemas
export { 
  systemsListQuerySchema, 
  systemsListResponseSchema, 
  systemsSearchQuerySchema, 
  systemsSearchResponseSchema, 
  systemsGetResponseSchema, 
  systemsErrorSchema 
} from './systems.schema.js';

// Pinecone schemas
export { pineconeSearchSchema, pineconeQuerySchema, pineconeStatsQuerySchema, pineconeStatsResponseSchema, pineconeSearchRequestSchema, pineconeSearchResponseSchema, pineconeErrorSchema } from './pinecone.schema.js';

// Admin schemas
export { 
  adminLogsQuerySchema,
  adminLogsResponseSchema,
  adminSystemsResponseSchema,
  adminPineconeResponseSchema,
  adminManufacturersResponseSchema,
  adminModelsQuerySchema,
  adminModelsResponseSchema
} from './admin.schema.js';

// Common schemas
export { 
  paginationQuerySchema, 
  idSchema, 
  querySchema, 
  emptySchema,
  errorResponseSchema,
  successResponseSchema
} from './common.schema.js';
