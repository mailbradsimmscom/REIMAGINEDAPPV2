#!/usr/bin/env node

/**
 * Test Fact-First Retrieval Integration
 * Tests the knowledgeRepository.findFactMatchByQuery() function directly
 */

import { logger } from '../src/utils/logger.js';
import knowledgeRepository from '../src/repositories/knowledge.repository.js';
import { formatFactAnswer } from '../src/utils/formatter.js';

const scriptLogger = logger.createRequestLogger();

async function testFactFirstRetrieval() {
  console.log('🧪 Testing Fact-First Retrieval Integration');
  console.log('==========================================');
  
  try {
    // Test queries that might match facts
    const testQueries = [
      'What is the pressure rating?',
      'How do I change the filter?',
      'What is the voltage specification?',
      'How to flush the system?',
      'What is the temperature range?',
      'How to test pressure?'
    ];
    
    for (const query of testQueries) {
      console.log(`\n🔍 Testing query: "${query}"`);
      
      try {
        const factMatch = await knowledgeRepository.findFactMatchByQuery(query);
        
        if (factMatch) {
          const factAnswer = formatFactAnswer(factMatch);
          console.log(`✅ FACT FOUND:`);
          console.log(`   Type: ${factMatch.fact_type}`);
          console.log(`   Key: ${factMatch.key || 'N/A'}`);
          console.log(`   Intent: ${factMatch.intent || 'N/A'}`);
          console.log(`   Query: ${factMatch.query || 'N/A'}`);
          console.log(`   Answer: ${factAnswer}`);
        } else {
          console.log(`❌ No fact found - would fallback to Pinecone`);
        }
      } catch (error) {
        console.log(`⚠️ Error checking facts: ${error.message}`);
      }
    }
    
    // Test knowledge repository health
    console.log(`\n📊 Testing Knowledge Repository Health`);
    try {
      const stats = await knowledgeRepository.getFactStatistics();
      console.log(`✅ Repository healthy:`, stats.data);
    } catch (error) {
      console.log(`❌ Repository health check failed: ${error.message}`);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testFactFirstRetrieval().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});