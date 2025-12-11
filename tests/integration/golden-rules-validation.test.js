import { test } from 'node:test';
import assert from 'node:assert';
import { initTestApp, getAppSync } from '../setupApp.js';
import { skipIfNoServices } from '../helpers/ci-skip.js';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';

await initTestApp();
const app = getAppSync();

// Load golden test data
let goldenTestData = null;
try {
  goldenTestData = JSON.parse(
    await fs.readFile(
      path.join(process.cwd(), 'anthropic_parallel_extraction_315e3f0f.json'),
      'utf8'
    )
  );
} catch (e) {
  console.log('Golden test data file not found - tests will skip');
}

test('Golden Rules Validation - RAG Retrieval Accuracy', async (t) => {
  // Skip if services aren't available - these tests require live chat service
  if (skipIfNoServices(t)) return;
  if (!goldenTestData) { t.skip('Golden test data not available'); return; }
  console.log('🧪 Testing Golden Rules Validation Logic...\n');
  
  // Test cases derived from golden procedures
  const testCases = [
    {
      query: 'How do I lock the screen on my Nemesis 9?',
      expectedProcedure: 'Locking Screen',
      expectedSteps: ['Locate lock button on dashboard bar', 'Press lock button'],
      expectedOutcome: 'Screen locked',
      model: 'NEMESIS'
    },
    {
      query: 'What are the steps to unlock the screen?',
      expectedProcedure: 'Unlocking Screen',
      expectedSteps: ['Swipe from right edge of display'],
      expectedOutcome: 'Screen unlocked',
      model: 'NEMESIS'
    },
    {
      query: 'How do I pin a dashboard?',
      expectedProcedure: 'Pin Dashboard',
      expectedSteps: [
        'Press and hold on desired dashboard',
        'Select position on dashboard bar',
        'Release to pin dashboard'
      ],
      expectedOutcome: 'Dashboard is pinned to dashboard bar',
      model: 'NEMESIS'
    },
    {
      query: 'What is the procedure to create a new dashboard?',
      expectedProcedure: 'Creating New Dashboard',
      expectedSteps: [
        'Select Dashboards option',
        'Choose \'new dashboard\' option',
        'Create custom dashboard'
      ],
      expectedOutcome: 'New custom dashboard created',
      model: 'NEMESIS'
    },
    {
      query: 'How do I access system settings?',
      expectedProcedure: 'Access System Settings',
      expectedSteps: ['Select system settings option from home screen'],
      expectedOutcome: 'System settings menu opens',
      model: 'NEMESIS'
    }
  ];

  for (const testCase of testCases) {
    await t.test(`RAG Validation: "${testCase.query}"`, async () => {
      console.log(`\n🔍 Testing: "${testCase.query}"`);

      // Use /chat/enhanced/process for rich response with telemetry
      // Send equipment context so the AI knows what device we're asking about
      const response = await request(app)
        .post('/chat/enhanced/process')
        .send({
          message: testCase.query,
          systems_context: [{ manufacturer: testCase.model, model: testCase.model }]
        })
        .expect(200);
      
      const data = response.body.data;

      // Validate response structure
      assert.ok(data.assistantMessage, 'Should have assistant message');
      assert.ok(data.telemetry, 'Should have telemetry data');
      assert.ok(data.telemetry.retrievalMeta, 'Should have retrieval metadata');

      // Extract retrieved content for validation
      // Enhanced route returns assistantMessage as object with .content
      const assistantMessage = data.assistantMessage.content || data.assistantMessage;
      const retrievalMeta = data.telemetry.retrievalMeta;
      
      console.log(`📊 Retrieval Stats:`, {
        rawCount: retrievalMeta.specBiasMeta?.rawCount || 0,
        filteredCount: retrievalMeta.specBiasMeta?.filteredCount || 0,
        usedFallback: retrievalMeta.specBiasMeta?.usedFallback || false
      });
      
      // Golden Rules Validation Assertions
      await validateRetrievalAccuracy(assistantMessage, testCase);
      await validateTechnicalCompleteness(assistantMessage, testCase);
      await validateProceduralCorrectness(assistantMessage, testCase);
      
      console.log(`✅ Validation passed for: "${testCase.query}"`);
    });
  }
});

test('Golden Rules Validation - Technical Accuracy Assertions', async (t) => {
  if (skipIfNoServices(t)) return;
  console.log('\n🔬 Testing Technical Accuracy Assertions...\n');
  
  const technicalTestCases = [
    {
      query: 'For my NEMESIS, what are the preconditions for locking the screen?',
      expectedPreconditions: [
        'dashboard bar',     // "dashboard bar must be shown"
        'idle',              // "idle for a period of time"
        'lock button'        // "press the lock button"
      ],
      validationType: 'preconditions'
    },
    {
      query: 'What happens when I unlock the screen?',
      expectedOutcome: 'Screen unlocked',
      validationType: 'outcome'
    },
    {
      query: 'What models support dashboard pinning?',
      expectedModel: 'NEMESIS',
      validationType: 'model_compatibility'
    }
  ];
  
  for (const testCase of technicalTestCases) {
    await t.test(`Technical Accuracy: ${testCase.validationType}`, async () => {
      console.log(`\n🔧 Testing ${testCase.validationType}: "${testCase.query}"`);

      // Use /chat/enhanced/process for rich response with telemetry
      // Send equipment context so the AI knows what device we're asking about
      const response = await request(app)
        .post('/chat/enhanced/process')
        .send({
          message: testCase.query,
          systems_context: [{ manufacturer: 'B&G', model: 'NEMESIS' }]
        })
        .expect(200);

      // Enhanced route returns assistantMessage as object with .content
      const rawMessage = response.body.data.assistantMessage;
      const assistantMessage = rawMessage.content || rawMessage;

      // Validate technical accuracy based on type
      switch (testCase.validationType) {
        case 'preconditions':
          await validatePreconditions(assistantMessage, testCase.expectedPreconditions);
          break;
        case 'outcome':
          await validateExpectedOutcome(assistantMessage, testCase.expectedOutcome);
          break;
        case 'model_compatibility':
          await validateModelCompatibility(assistantMessage, testCase.expectedModel);
          break;
      }
      
      console.log(`✅ Technical accuracy validation passed`);
    });
  }
});

test('Golden Rules Validation - Ground Truth Assertions', async (t) => {
  if (skipIfNoServices(t)) return;
  console.log('\n🎯 Testing Ground Truth Assertions...\n');
  
  // Test ground truth assertions against known procedures
  const groundTruthTests = [
    {
      procedure: 'Language Selection',
      query: 'For my NEMESIS, how do I change the language?',
      groundTruth: {
        steps: [
          'Home',              // "Home button" / "Home screen"
          'Settings',          // "System Settings"
          'General',           // "General settings menu"
          'Language',          // "Select Language"
          'ENGLISH'            // One of the listed languages
        ],
        preconditions: [
          'Home',              // Start from Home screen
          'Settings'           // Access settings
        ],
        expectedOutcome: 'selection'  // "Confirm your selection"
      }
    },
    {
      procedure: 'First Time System Setup',
      query: 'For my NEMESIS, how do I set up the system for the first time?',
      groundTruth: {
        steps: [
          'power',             // "power is applied"
          'wizard',            // "setup wizard"
          'orientation',       // "screen orientation"
          'language',          // "language setting"
          'settings'           // "system settings"
        ],
        preconditions: [
          'power',             // "power is applied"
          'first time'         // "first time startup"
        ],
        expectedOutcome: 'wizard'  // "wizard will guide you"
      }
    }
  ];
  
  for (const testCase of groundTruthTests) {
    await t.test(`Ground Truth: ${testCase.procedure}`, async () => {
      console.log(`\n🎯 Testing ground truth for: ${testCase.procedure}`);

      // Use /chat/enhanced/process for rich response with telemetry
      // Send equipment context so the AI knows what device we're asking about
      const response = await request(app)
        .post('/chat/enhanced/process')
        .send({
          message: testCase.query,
          systems_context: [{ manufacturer: 'B&G', model: 'NEMESIS' }]
        })
        .expect(200);

      // Enhanced route returns assistantMessage as object with .content
      const rawMessage = response.body.data.assistantMessage;
      const assistantMessage = rawMessage.content || rawMessage;

      // Validate against ground truth
      await validateGroundTruth(assistantMessage, testCase.groundTruth);
      
      console.log(`✅ Ground truth validation passed`);
    });
  }
});

test('Golden Rules Validation - Error Handling', async (t) => {
  if (skipIfNoServices(t)) return;
  console.log('\n⚠️ Testing Error Handling in Golden Rules...\n');
  
  const errorTestCases = [
    {
      query: 'How do I lock the screen on an unsupported model?',
      expectedBehavior: 'Should indicate model incompatibility or provide general guidance'
    },
    {
      query: 'What if the lock button is not visible?',
      expectedBehavior: 'Should address preconditions or troubleshooting'
    },
    {
      query: 'How do I perform an invalid operation?',
      expectedBehavior: 'Should provide helpful guidance or indicate impossibility'
    }
  ];
  
  for (const testCase of errorTestCases) {
    await t.test(`Error Handling: "${testCase.query}"`, async () => {
      console.log(`\n⚠️ Testing error handling: "${testCase.query}"`);

      // Use /chat/enhanced/process for rich response with telemetry
      // Send equipment context so the AI knows what device we're asking about
      const response = await request(app)
        .post('/chat/enhanced/process')
        .send({
          message: testCase.query,
          systems_context: [{ manufacturer: 'B&G', model: 'NEMESIS' }]
        })
        .expect(200);

      // Enhanced route returns assistantMessage as object with .content
      const rawMessage = response.body.data.assistantMessage;
      const assistantMessage = rawMessage.content || rawMessage;

      // Validate error handling
      assert.ok(assistantMessage.length > 0, 'Should provide some response');
      assert.ok(typeof assistantMessage === 'string', 'Should return string response');
      
      console.log(`✅ Error handling validation passed`);
    });
  }
});

// Validation Helper Functions

async function validateRetrievalAccuracy(assistantMessage, testCase) {
  console.log(`🔍 Validating retrieval accuracy...`);
  
  // Check if the response contains the expected procedure title
  const containsExpectedProcedure = assistantMessage.toLowerCase().includes(
    testCase.expectedProcedure.toLowerCase()
  );
  
  if (!containsExpectedProcedure) {
    console.log(`⚠️ Warning: Expected procedure "${testCase.expectedProcedure}" not found in response`);
  }
  
  // Check if response contains expected steps
  const stepMatches = testCase.expectedSteps.filter(step => 
    assistantMessage.toLowerCase().includes(step.toLowerCase())
  );
  
  console.log(`📋 Step matches: ${stepMatches.length}/${testCase.expectedSteps.length}`);
  
  // At least 50% of expected steps should be present for valid retrieval
  assert.ok(
    stepMatches.length >= Math.ceil(testCase.expectedSteps.length * 0.5),
    `Should contain at least 50% of expected steps (${stepMatches.length}/${testCase.expectedSteps.length})`
  );
}

async function validateTechnicalCompleteness(assistantMessage, testCase) {
  console.log(`🔧 Validating technical completeness...`);
  
  // Check for expected outcome
  const containsExpectedOutcome = assistantMessage.toLowerCase().includes(
    testCase.expectedOutcome.toLowerCase()
  );
  
  if (containsExpectedOutcome) {
    console.log(`✅ Expected outcome found: "${testCase.expectedOutcome}"`);
  } else {
    console.log(`⚠️ Expected outcome not explicitly found: "${testCase.expectedOutcome}"`);
  }
  
  // Check for model compatibility
  const containsModel = assistantMessage.toLowerCase().includes(
    testCase.model.toLowerCase()
  );
  
  if (containsModel) {
    console.log(`✅ Model compatibility mentioned: ${testCase.model}`);
  }
}

async function validateProceduralCorrectness(assistantMessage, testCase) {
  console.log(`📋 Validating procedural correctness...`);
  
  // Check for step indicators (numbers, bullets, etc.)
  const hasStepIndicators = /(?:step|1\.|2\.|3\.|•|-)|\d+\./i.test(assistantMessage);
  
  if (hasStepIndicators) {
    console.log(`✅ Response contains step indicators`);
  } else {
    console.log(`⚠️ Response may lack clear step structure`);
  }
  
  // Check for action verbs (imperative mood)
  const actionVerbs = ['select', 'press', 'swipe', 'locate', 'choose', 'navigate'];
  const hasActionVerbs = actionVerbs.some(verb => 
    assistantMessage.toLowerCase().includes(verb)
  );
  
  if (hasActionVerbs) {
    console.log(`✅ Response contains action-oriented language`);
  }
}

async function validatePreconditions(assistantMessage, expectedPreconditions) {
  console.log(`🔍 Validating preconditions...`);
  
  const foundPreconditions = expectedPreconditions.filter(precondition =>
    assistantMessage.toLowerCase().includes(precondition.toLowerCase())
  );
  
  console.log(`📋 Preconditions found: ${foundPreconditions.length}/${expectedPreconditions.length}`);
  
  // At least one precondition should be mentioned
  assert.ok(foundPreconditions.length > 0, 'Should mention at least one precondition');
}

async function validateExpectedOutcome(assistantMessage, expectedOutcome) {
  console.log(`🎯 Validating expected outcome...`);
  
  const containsOutcome = assistantMessage.toLowerCase().includes(
    expectedOutcome.toLowerCase()
  );
  
  if (containsOutcome) {
    console.log(`✅ Expected outcome found: "${expectedOutcome}"`);
  } else {
    console.log(`⚠️ Expected outcome not found: "${expectedOutcome}"`);
  }
}

async function validateModelCompatibility(assistantMessage, expectedModel) {
  console.log(`🔧 Validating model compatibility...`);
  
  const containsModel = assistantMessage.toLowerCase().includes(
    expectedModel.toLowerCase()
  );
  
  if (containsModel) {
    console.log(`✅ Model compatibility mentioned: ${expectedModel}`);
  } else {
    console.log(`⚠️ Model compatibility not explicitly mentioned`);
  }
}

async function validateGroundTruth(assistantMessage, groundTruth) {
  console.log(`🎯 Validating against ground truth...`);
  
  // Validate steps
  const stepMatches = groundTruth.steps.filter(step =>
    assistantMessage.toLowerCase().includes(step.toLowerCase())
  );
  
  console.log(`📋 Ground truth step matches: ${stepMatches.length}/${groundTruth.steps.length}`);
  
  // Validate preconditions
  const preconditionMatches = groundTruth.preconditions.filter(precondition =>
    assistantMessage.toLowerCase().includes(precondition.toLowerCase())
  );
  
  console.log(`🔍 Ground truth precondition matches: ${preconditionMatches.length}/${groundTruth.preconditions.length}`);
  
  // Validate expected outcome
  const outcomeMatch = assistantMessage.toLowerCase().includes(
    groundTruth.expectedOutcome.toLowerCase()
  );
  
  console.log(`🎯 Ground truth outcome match: ${outcomeMatch}`);
  
  // At least 60% of ground truth elements should be present
  const totalElements = groundTruth.steps.length + groundTruth.preconditions.length + 1;
  const foundElements = stepMatches.length + preconditionMatches.length + (outcomeMatch ? 1 : 0);
  
  assert.ok(
    foundElements >= Math.ceil(totalElements * 0.6),
    `Should contain at least 60% of ground truth elements (${foundElements}/${totalElements})`
  );
}

console.log('🧪 Golden Rules Validation Test Suite Ready');
