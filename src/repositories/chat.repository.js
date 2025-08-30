import { getSupabaseClient } from './supabaseClient.js';

const SESSIONS_TABLE = 'chat_sessions';
const THREADS_TABLE = 'chat_threads';
const MESSAGES_TABLE = 'chat_messages';

export async function createChatSession({ name, description, metadata = {} } = {}) {
  try {
    const supabase = getSupabaseClient();
    
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
    const supabase = getSupabaseClient();
    
    const { data, error } = await supabase
      .from(SESSIONS_TABLE)
      .select('*')
      .eq('id', sessionId)
      .single();
    
    if (error) {
      const err = new Error(`Failed to get chat session: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'get_session', sessionId, table: SESSIONS_TABLE };
      throw err;
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
    const supabase = getSupabaseClient();
    
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
    const supabase = getSupabaseClient();
    
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
    const supabase = getSupabaseClient();
    
    const { data, error } = await supabase
      .from(THREADS_TABLE)
      .select('*')
      .eq('id', threadId)
      .single();
    
    if (error) {
      const err = new Error(`Failed to get chat thread: ${error.message}`);
      err.cause = error;
      err.context = { operation: 'get_thread', threadId, table: THREADS_TABLE };
      throw err;
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
    const supabase = getSupabaseClient();
    
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
    const supabase = getSupabaseClient();
    
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
    const supabase = getSupabaseClient();
    
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
    const supabase = getSupabaseClient();
    
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
    const supabase = getSupabaseClient();
    
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
  updateChatThread
};
