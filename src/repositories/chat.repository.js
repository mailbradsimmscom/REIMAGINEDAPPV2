import { getSupabaseClient } from './supabaseClient.js';
import { isSupabaseConfigured } from '../services/guards/index.js';

const SESSIONS_TABLE = 'chat_sessions';
const THREADS_TABLE = 'chat_threads';
const MESSAGES_TABLE = 'chat_messages';

// Helper function to check if Supabase is available
async function checkSupabaseAvailability() {
  if (!isSupabaseConfigured()) {
    const error = new Error('Supabase not configured');
    error.code = 'SUPABASE_DISABLED';
    throw error;
  }
  
  const supabase = await getSupabaseClient();
  if (!supabase) {
    const error = new Error('Supabase client not available');
    error.code = 'SUPABASE_DISABLED';
    throw error;
  }
  
  return supabase;
}

export async function createChatSession({ name, description, metadata = {} } = {}) {
  try {
    const supabase = await checkSupabaseAvailability();
    
    const { data, error } = await supabase
      .from(SESSIONS_TABLE)
      .insert({
        name: name || 'New Chat',
        description: description || '',
        metadata,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      const err = new Error(`Failed to create chat session: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'create_session', table: SESSIONS_TABLE };
      throw err;
    }
    
    return data;
  } catch (error) {
    if (!error.context) {
      error.context = { operation: 'create_session', table: SESSIONS_TABLE };
    }
    throw error;
  }
}

export async function getChatSession(sessionId) {
  try {
    const supabase = await checkSupabaseAvailability();
    
    const { data, error } = await supabase
      .from(SESSIONS_TABLE)
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();
    
    if (error) {
      const err = new Error(`Failed to get chat session: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'get_session', sessionId, table: SESSIONS_TABLE };
      throw err;
    }
    
    if (!data) {
      throw new Error(`No chat session found for session_id: ${sessionId}`);
    }
    
    return data;
  } catch (error) {
    if (!error.context) {
      error.context = { operation: 'get_session', sessionId, table: SESSIONS_TABLE };
    }
    throw error;
  }
}

export async function listChatSessions({ limit = 25, cursor } = {}) {
  try {
    const supabase = await checkSupabaseAvailability();
    
    let query = supabase
      .from(SESSIONS_TABLE)
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(limit);
    
    if (cursor) {
      query = query.lt('updated_at', cursor);
    }
    
    const { data, error } = await query;
    
    if (error) {
      const err = new Error(`Failed to list chat sessions: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'list_sessions', limit, cursor, table: SESSIONS_TABLE };
      throw err;
    }
    
    return data ?? [];
  } catch (error) {
    if (!error.context) {
      error.context = { operation: 'list_sessions', limit, cursor, table: SESSIONS_TABLE };
    }
    throw error;
  }
}

export async function createChatThread({ sessionId, name, metadata = {} } = {}) {
  try {
    const supabase = await checkSupabaseAvailability();
    
    const { data, error } = await supabase
      .from(THREADS_TABLE)
      .insert({
        session_id: sessionId,
        name: name || 'New Thread',
        metadata,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      const err = new Error(`Failed to create chat thread: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'create_thread', sessionId, table: THREADS_TABLE };
      throw err;
    }
    
    return data;
  } catch (error) {
    if (!error.context) {
      error.context = { operation: 'create_thread', sessionId, table: THREADS_TABLE };
    }
    throw error;
  }
}

export async function getChatThread(threadId) {
  try {
    const supabase = await checkSupabaseAvailability();
    
    const { data, error } = await supabase
      .from(THREADS_TABLE)
      .select('*')
      .eq('id', threadId)
      .maybeSingle();
    
    if (error) {
      const err = new Error(`Failed to get chat thread: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'get_thread', threadId, table: THREADS_TABLE };
      throw err;
    }
    
    if (!data) {
      throw new Error(`No chat thread found for thread_id: ${threadId}`);
    }
    
    return data;
  } catch (error) {
    if (!error.context) {
      error.context = { operation: 'get_thread', threadId, table: THREADS_TABLE };
    }
    throw error;
  }
}

export async function listChatThreads(sessionId, { limit = 25, cursor } = {}) {
  try {
    const supabase = await checkSupabaseAvailability();
    
    let query = supabase
      .from(THREADS_TABLE)
      .select('*')
      .eq('session_id', sessionId)
      .order('updated_at', { ascending: false })
      .limit(limit);
    
    if (cursor) {
      query = query.lt('updated_at', cursor);
    }
    
    const { data, error } = await query;
    
    if (error) {
      const err = new Error(`Failed to list chat threads: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'list_threads', sessionId, limit, cursor, table: THREADS_TABLE };
      throw err;
    }
    
    return data ?? [];
  } catch (error) {
    if (!error.context) {
      error.context = { operation: 'list_threads', sessionId, limit, cursor, table: THREADS_TABLE };
    }
    throw error;
  }
}

export async function createChatMessage({ threadId, role, content, metadata = {} } = {}) {
  try {
    const supabase = await checkSupabaseAvailability();
    
    const { data, error } = await supabase
      .from(MESSAGES_TABLE)
      .insert({
        thread_id: threadId,
        role, // 'user' or 'assistant'
        content,
        metadata,
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      const err = new Error(`Failed to create chat message: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'create_message', threadId, role, table: MESSAGES_TABLE };
      throw err;
    }
    
    return data;
  } catch (error) {
    if (!error.context) {
      error.context = { operation: 'create_message', threadId, role, table: MESSAGES_TABLE };
    }
    throw error;
  }
}

export async function getChatMessages(threadId, { limit = 50, cursor } = {}) {
  try {
    const supabase = await checkSupabaseAvailability();
    
    let query = supabase
      .from(MESSAGES_TABLE)
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(limit);
    
    if (cursor) {
      query = query.gt('created_at', cursor);
    }
    
    const { data, error } = await query;
    
    if (error) {
      const err = new Error(`Failed to get chat messages: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'get_messages', threadId, limit, cursor, table: MESSAGES_TABLE };
      throw err;
    }
    
    return data ?? [];
  } catch (error) {
    if (!error.context) {
      error.context = { operation: 'get_messages', threadId, limit, cursor, table: MESSAGES_TABLE };
    }
    throw error;
  }
}

export async function updateChatSession(sessionId, updates) {
  try {
    const supabase = await checkSupabaseAvailability();
    
    const { data, error } = await supabase
      .from(SESSIONS_TABLE)
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select()
      .single();
    
    if (error) {
      const err = new Error(`Failed to update chat session: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'update_session', sessionId, updates, table: SESSIONS_TABLE };
      throw err;
    }
    
    return data;
  } catch (error) {
    if (!error.context) {
      error.context = { operation: 'update_session', sessionId, updates, table: SESSIONS_TABLE };
    }
    throw error;
  }
}

export async function updateChatThread(threadId, updates) {
  try {
    const supabase = await checkSupabaseAvailability();
    
    const { data, error } = await supabase
      .from(THREADS_TABLE)
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', threadId)
      .select()
      .single();
    
    if (error) {
      const err = new Error(`Failed to update chat thread: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'update_thread', threadId, updates, table: THREADS_TABLE };
      throw err;
    }
    
    return data;
  } catch (error) {
    if (!error.context) {
      error.context = { operation: 'update_thread', threadId, updates, table: THREADS_TABLE };
    }
    throw error;
  }
}

export async function deleteChatMessages(threadId) {
  try {
    const supabase = await checkSupabaseAvailability();
    
    const { error } = await supabase
      .from(MESSAGES_TABLE)
      .delete()
      .eq('thread_id', threadId);
    
    if (error) {
      const err = new Error(`Failed to delete chat messages: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'delete_messages', threadId, table: MESSAGES_TABLE };
      throw err;
    }
    
    return { success: true };
  } catch (error) {
    if (!error.context) {
      error.context = { operation: 'delete_messages', threadId, table: MESSAGES_TABLE };
    }
    throw error;
  }
}

export async function deleteChatThreads(sessionId) {
  try {
    const supabase = await checkSupabaseAvailability();
    
    const { error } = await supabase
      .from(THREADS_TABLE)
      .delete()
      .eq('session_id', sessionId);
    
    if (error) {
      const err = new Error(`Failed to delete chat threads: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'delete_threads', sessionId, table: THREADS_TABLE };
      throw err;
    }
    
    return { success: true };
  } catch (error) {
    if (!error.context) {
      error.context = { operation: 'delete_threads', sessionId, table: THREADS_TABLE };
    }
    throw error;
  }
}

export async function deleteChatSession(sessionId) {
  try {
    const supabase = await checkSupabaseAvailability();
    
    const { error } = await supabase
      .from(SESSIONS_TABLE)
      .delete()
      .eq('id', sessionId);
    
    if (error) {
      const err = new Error(`Failed to delete chat session: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'delete_session', sessionId, table: SESSIONS_TABLE };
      throw err;
    }
    
    return { success: true };
  } catch (error) {
    if (!error.context) {
      error.context = { operation: 'delete_session', sessionId, table: SESSIONS_TABLE };
    }
    throw error;
  }
}

export default {
  createChatSession,
  getChatSession,
  listChatSessions,
  createChatThread,
  getChatThread,
  listChatThreads,
  createChatMessage,
  getChatMessages,
  updateChatSession,
  updateChatThread,
  deleteChatMessages,
  deleteChatThreads,
  deleteChatSession
};
