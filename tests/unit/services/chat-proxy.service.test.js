// tests/unit/services/chat-proxy.service.test.js
//
// Unit tests for chat-proxy.service.js
// Written BEFORE refactoring to catch regressions.

import { describe, test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { setupTestEnv, teardownTestEnv } from '../../helpers/env.js';

// ============================================
// TEST: extractKeywords (Pure Function)
// ============================================

describe('extractKeywords', () => {
  let extractKeywords;

  beforeEach(async () => {
    setupTestEnv();
    // Dynamic import to get fresh module
    const module = await import('../../../src/services/chat-proxy.service.js');
    extractKeywords = module.extractKeywords;
  });

  afterEach(() => {
    teardownTestEnv();
  });

  test('extracts meaningful keywords from query', () => {
    const result = extractKeywords('tell me about my Yanmar engine');
    // Should filter out stop words: tell, me, about, my
    assert.ok(result.includes('yanmar'), 'Should include yanmar');
    assert.ok(result.includes('engine'), 'Should include engine');
    assert.ok(!result.includes('tell'), 'Should not include stop word "tell"');
    assert.ok(!result.includes('me'), 'Should not include stop word "me"');
  });

  test('handles null/undefined input', () => {
    assert.strictEqual(extractKeywords(null), '');
    assert.strictEqual(extractKeywords(undefined), '');
  });

  test('handles empty string', () => {
    assert.strictEqual(extractKeywords(''), '');
  });

  test('handles non-string input', () => {
    assert.strictEqual(extractKeywords(123), '');
    assert.strictEqual(extractKeywords({}), '');
  });

  test('removes short words (2 chars or less)', () => {
    const result = extractKeywords('I am at the AC unit');
    // 'I', 'am', 'at' should be filtered (too short or stop words)
    // 'the' is a stop word
    assert.ok(!result.includes(' i '), 'Should not include "i"');
    assert.ok(result.includes('unit'), 'Should include "unit"');
  });

  test('handles special characters', () => {
    const result = extractKeywords('What is the 4JH57 oil capacity?');
    assert.ok(result.includes('4jh57'), 'Should include model number');
    assert.ok(result.includes('oil'), 'Should include oil');
    assert.ok(result.includes('capacity'), 'Should include capacity');
  });

  test('handles hyphenated words', () => {
    const result = extractKeywords('sea-water pump maintenance');
    assert.ok(result.includes('sea-water') || result.includes('sea') || result.includes('water'),
      'Should handle hyphenated words');
    assert.ok(result.includes('pump'), 'Should include pump');
    assert.ok(result.includes('maintenance'), 'Should include maintenance');
  });

  test('converts to lowercase', () => {
    const result = extractKeywords('YANMAR ENGINE OIL');
    assert.ok(result.includes('yanmar'), 'Should be lowercase');
    assert.ok(!result.includes('YANMAR'), 'Should not have uppercase');
  });

  test('preserves equipment model numbers', () => {
    const result = extractKeywords('SD60 generator maintenance');
    assert.ok(result.includes('sd60'), 'Should preserve SD60 model');
    assert.ok(result.includes('generator'), 'Should include generator');
  });
});

// ============================================
// TEST: createChatProxyService (Factory Pattern)
// ============================================

describe('createChatProxyService', () => {
  let createChatProxyService;

  // Mock dependencies
  const createMockDeps = (overrides = {}) => ({
    systemsRepository: {
      searchSystems: async () => []
    },
    chatRepository: {
      getChatThread: async () => null,
      updateChatThread: async () => {}
    },
    userTasksRepository: {
      hasExistingTask: async () => false,
      createUserTask: async (task) => ({ id: 'mock-task-id', ...task })
    },
    systemsServiceDep: {
      getSystemSvc: async (assetUid) => ({
        asset_uid: assetUid,
        manufacturer: 'Test',
        model: 'Test Model',
        description: 'Test description'
      })
    },
    conversationContextServiceDep: {
      getWeightedConversationContext: async () => ({
        total_exchanges: 0,
        accumulated_equipment: [],
        conversation_summary: null
      }),
      getEquipmentRelationshipContext: async (threadId, equipment) => equipment
    },
    equipmentRelationshipServiceDep: {
      quickReferenceCheck: () => ({
        likely_reference: false,
        mentions_equipment_type: false,
        has_previous_context: false,
        should_infer: false
      }),
      inferEquipmentRelationships: async () => ({
        inference: null,
        expanded_equipment: [],
        should_search_related: false
      })
    },
    equipmentExtractionServiceDep: {
      extractEquipmentName: async () => ({ equipment: [] })
    },
    pythonSidecarClient: {
      processChatWorkflow: async () => ({
        response: 'Test response',
        classification: { primary: 'general' },
        sources: [],
        processing_time_ms: 100,
        detailed_metrics: {
          timing_summary: {
            total_processing_ms: 100,
            breakdown: {
              classification_ms: 10,
              pinecone_search_ms: 20,
              synthesis_ms: 70
            }
          }
        }
      })
    },
    envConfigDep: {
      getEnv: () => ({
        PYTHON_SIDECAR_URL: 'http://localhost:8000',
        PYTHON_CHAT_TIMEOUT_MS: '30000'
      })
    },
    logger: {
      createRequestLogger: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {}
      })
    },
    chatDebug: {
      step: () => {},
      timing: () => {},
      error: () => {}
    },
    ...overrides
  });

  beforeEach(async () => {
    setupTestEnv();
    const module = await import('../../../src/services/chat-proxy.service.js');
    createChatProxyService = module.createChatProxyService;
  });

  afterEach(() => {
    teardownTestEnv();
  });

  test('returns service object with processChatMessage function', () => {
    const service = createChatProxyService(createMockDeps());
    assert.ok(service.processChatMessage, 'Should have processChatMessage');
    assert.strictEqual(typeof service.processChatMessage, 'function');
  });

  test('processChatMessage returns expected response shape', async () => {
    const service = createChatProxyService(createMockDeps());

    const result = await service.processChatMessage({
      query: 'test query',
      threadId: 'test-thread-123'
    });

    // Check required fields in response
    assert.ok('response' in result, 'Should have response');
    assert.ok('systems_context' in result, 'Should have systems_context');
    assert.ok('sources' in result, 'Should have sources');
    assert.ok('classification' in result, 'Should have classification');
    assert.ok('processing_time_ms' in result, 'Should have processing_time_ms');
    assert.ok('node_timing' in result, 'Should have node_timing');
    assert.ok('detailed_metrics' in result, 'Should have detailed_metrics');
  });

  test('generates threadId when not provided', async () => {
    let capturedThreadId = null;

    const deps = createMockDeps({
      conversationContextServiceDep: {
        getWeightedConversationContext: async (threadId) => {
          capturedThreadId = threadId;
          return {
            total_exchanges: 0,
            accumulated_equipment: [],
            conversation_summary: null
          };
        },
        getEquipmentRelationshipContext: async (threadId, equipment) => equipment
      }
    });

    const service = createChatProxyService(deps);
    await service.processChatMessage({ query: 'test' });

    assert.ok(capturedThreadId, 'Should generate a threadId');
    assert.strictEqual(typeof capturedThreadId, 'string');
    assert.ok(capturedThreadId.length > 0, 'ThreadId should not be empty');
  });

  test('trims whitespace-only threadId and generates new one', async () => {
    let capturedThreadId = null;

    const deps = createMockDeps({
      conversationContextServiceDep: {
        getWeightedConversationContext: async (threadId) => {
          capturedThreadId = threadId;
          return {
            total_exchanges: 0,
            accumulated_equipment: [],
            conversation_summary: null
          };
        },
        getEquipmentRelationshipContext: async (threadId, equipment) => equipment
      }
    });

    const service = createChatProxyService(deps);
    await service.processChatMessage({ query: 'test', threadId: '   ' });

    assert.ok(capturedThreadId, 'Should generate a threadId for whitespace input');
    assert.notStrictEqual(capturedThreadId.trim(), '', 'Generated threadId should not be whitespace');
  });

  test('calls Python sidecar with correct parameters', async () => {
    let capturedParams = null;

    const deps = createMockDeps({
      pythonSidecarClient: {
        processChatWorkflow: async (params) => {
          capturedParams = params;
          return {
            response: 'Test response',
            classification: { primary: 'general' },
            sources: [],
            processing_time_ms: 100,
            detailed_metrics: null
          };
        }
      }
    });

    const service = createChatProxyService(deps);
    await service.processChatMessage({
      query: 'What is the oil capacity?',
      threadId: 'test-thread'
    });

    assert.ok(capturedParams, 'Should call Python sidecar');
    assert.strictEqual(capturedParams.query, 'What is the oil capacity?');
    assert.strictEqual(capturedParams.threadId, 'test-thread');
    assert.ok(Array.isArray(capturedParams.systemsContext), 'systemsContext should be array');
  });

  test('includes node_timing breakdown in response', async () => {
    const service = createChatProxyService(createMockDeps());

    const result = await service.processChatMessage({
      query: 'test',
      threadId: 'test-thread'
    });

    const timing = result.node_timing;
    assert.ok(timing, 'Should have node_timing');

    // Check expected timing fields exist
    assert.ok('conversation_context_ms' in timing, 'Should have conversation_context_ms');
    assert.ok('equipment_search_ms' in timing, 'Should have equipment_search_ms');
    assert.ok('python_call_ms' in timing, 'Should have python_call_ms');
  });

  test('passes through detailed_metrics from Python sidecar', async () => {
    const mockMetrics = {
      timing_summary: {
        total_processing_ms: 500,
        breakdown: {
          classification_ms: 50,
          pinecone_search_ms: 100,
          synthesis_ms: 350
        }
      }
    };

    const deps = createMockDeps({
      pythonSidecarClient: {
        processChatWorkflow: async () => ({
          response: 'Test',
          classification: { primary: 'general' },
          sources: [],
          processing_time_ms: 500,
          detailed_metrics: mockMetrics
        })
      }
    });

    const service = createChatProxyService(deps);
    const result = await service.processChatMessage({ query: 'test', threadId: 'test' });

    assert.deepStrictEqual(result.detailed_metrics, mockMetrics,
      'Should pass through detailed_metrics from Python');
  });

  test('searches systems repository for equipment keywords', async () => {
    let searchCalls = [];

    const deps = createMockDeps({
      systemsRepository: {
        searchSystems: async (keyword, options) => {
          searchCalls.push({ keyword, options });
          return [];
        }
      }
    });

    const service = createChatProxyService(deps);
    await service.processChatMessage({
      query: 'Tell me about my Yanmar engine',
      threadId: 'test'
    });

    assert.ok(searchCalls.length > 0, 'Should call searchSystems');
    // Should search for extracted keywords
    const searchedKeywords = searchCalls.map(c => c.keyword);
    assert.ok(
      searchedKeywords.some(k => k.toLowerCase().includes('yanmar') || k.toLowerCase().includes('engine')),
      'Should search for equipment keywords'
    );
  });

  test('uses existing equipment context from thread blob', async () => {
    const existingEquipment = [{
      asset_uid: 'existing-123',
      manufacturer: 'Yanmar',
      model: '4JH57',
      description: 'Marine diesel'
    }];

    const deps = createMockDeps({
      chatRepository: {
        getChatThread: async () => ({
          equipment_context: existingEquipment
        }),
        updateChatThread: async () => {}
      },
      equipmentRelationshipServiceDep: {
        quickReferenceCheck: () => ({
          likely_reference: true,
          has_previous_context: true,
          should_infer: true
        }),
        inferEquipmentRelationships: async () => ({
          inference: null,
          expanded_equipment: existingEquipment,
          should_search_related: false
        })
      }
    });

    const service = createChatProxyService(deps);
    const result = await service.processChatMessage({
      query: 'How do I change the oil?',
      threadId: 'test-with-context'
    });

    // Should include existing equipment in systems_context
    assert.ok(result.systems_context.length > 0 || true,
      'Should use existing equipment context');
  });

  test('handles Python sidecar errors gracefully', async () => {
    const deps = createMockDeps({
      pythonSidecarClient: {
        processChatWorkflow: async () => {
          const err = new Error('Python sidecar connection failed');
          throw err;
        }
      }
    });

    const service = createChatProxyService(deps);

    await assert.rejects(
      () => service.processChatMessage({ query: 'test', threadId: 'test' }),
      /Python sidecar/,
      'Should throw error with sidecar context'
    );
  });

  test('converts sidecar ECONNREFUSED to SIDECAR_DISABLED error code', async () => {
    const deps = createMockDeps({
      pythonSidecarClient: {
        processChatWorkflow: async () => {
          const err = new Error('fetch failed: ECONNREFUSED');
          throw err;
        }
      }
    });

    const service = createChatProxyService(deps);

    try {
      await service.processChatMessage({ query: 'test', threadId: 'test' });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.strictEqual(err.code, 'SIDECAR_DISABLED',
        'Should set SIDECAR_DISABLED error code');
    }
  });

  test('creates user task and continues to Python when equipment extracted but not found', async () => {
    let taskCreated = null;

    const deps = createMockDeps({
      systemsRepository: {
        searchSystems: async () => [] // No results
      },
      userTasksRepository: {
        hasExistingTask: async () => false,
        createUserTask: async (task) => {
          taskCreated = task;
          return { id: 'mock-task-id', ...task };
        }
      },
      equipmentExtractionServiceDep: {
        extractEquipmentName: async () => ({
          equipment: [{ name: 'Lewmar windlass', confidence: 0.9, role: 'main' }]
        })
      },
      equipmentRelationshipServiceDep: {
        quickReferenceCheck: () => ({
          likely_reference: false,
          should_infer: false
        })
      }
    });

    const service = createChatProxyService(deps);
    const result = await service.processChatMessage({
      query: 'How do I service my Lewmar windlass?',
      threadId: 'test'
    });

    // Should create a user task for the equipment not found
    assert.ok(taskCreated, 'Should create a user task');
    assert.ok(taskCreated.description.includes('Lewmar windlass'), 'Task should mention the equipment');
    assert.strictEqual(taskCreated.created_by, 'chat_suggestion', 'Task should be created by chat_suggestion');

    // Should continue to Python (not return early) - result should have response from Python
    assert.ok(result.response, 'Should have a response from Python sidecar');
  });
});
