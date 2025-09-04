// src/middleware/serviceGuards.js
import { isSupabaseConfigured, isOpenAIConfigured, isPineconeConfigured, isSidecarConfigured } from '../services/guards/index.js';
import { ERR } from '../constants/errorCodes.js';

// Guard middleware for Supabase-dependent routes
export function requireSupabase() {
  return (req, res, next) => {
    if (!isSupabaseConfigured()) {
      const error = new Error('Supabase not configured');
      error.code = ERR.SUPABASE_DISABLED;
      return next(error);
    }
    next();
  };
}

// Guard middleware for OpenAI-dependent routes
export function requireOpenAI() {
  return (req, res, next) => {
    if (!isOpenAIConfigured()) {
      const error = new Error('OpenAI not configured');
      error.code = ERR.OPENAI_DISABLED;
      return next(error);
    }
    next();
  };
}

// Guard middleware for Pinecone-dependent routes
export function requirePinecone() {
  return (req, res, next) => {
    if (!isPineconeConfigured()) {
      const error = new Error('Pinecone not configured');
      error.code = ERR.PINECONE_DISABLED;
      return next(error);
    }
    next();
  };
}

// Guard middleware for Python sidecar-dependent routes
export function requireSidecar() {
  return (req, res, next) => {
    if (!isSidecarConfigured()) {
      const error = new Error('Python sidecar not configured');
      error.code = ERR.SIDECAR_DISABLED;
      return next(error);
    }
    next();
  };
}

// Guard middleware for multiple services
export function requireServices(services = []) {
  return (req, res, next) => {
    const errors = [];
    
    if (services.includes('supabase') && !isSupabaseConfigured()) {
      errors.push(ERR.SUPABASE_DISABLED);
    }
    
    if (services.includes('openai') && !isOpenAIConfigured()) {
      errors.push(ERR.OPENAI_DISABLED);
    }
    
    if (services.includes('pinecone') && !isPineconeConfigured()) {
      errors.push(ERR.PINECONE_DISABLED);
    }
    
    if (services.includes('sidecar') && !isSidecarConfigured()) {
      errors.push(ERR.SIDECAR_DISABLED);
    }
    
    if (errors.length > 0) {
      const error = new Error(`Required services not configured: ${errors.join(', ')}`);
      error.code = errors[0]; // Use the first error code
      error.disabledServices = errors;
      return next(error);
    }
    
    next();
  };
}
