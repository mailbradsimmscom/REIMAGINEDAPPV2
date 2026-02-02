#!/usr/bin/env node
/**
 * Test DIP exclude list computation
 *
 * Shows how to compute exclude lists for DIP using:
 *   - documents.models_covered (primary models)
 *   - document_referenced_systems with user_selected flag
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const docId = '0409b82f230dae2b3550a1ffc3c60b10ba1b364120fbc85358b8bee7a012cdaa';

// Simulate user's selections (matching test scripts: 4JH57, VC20, SD60)
const selectedModels = ['4JH57'];  // User's installed primary engine
const referencedSelections = ['VC20', 'SD60'];  // User's installed referenced systems

async function computeExcludeLists() {
  console.log('=== DIP EXCLUDE LIST COMPUTATION ===\n');
  console.log('User selections:');
  console.log('  selected_models:', selectedModels);
  console.log('  referenced_selections:', referencedSelections);

  // 1. Get models_covered from documents table
  const { data: doc, error: docErr } = await supabase
    .from('documents')
    .select('models_covered')
    .eq('doc_id', docId)
    .single();

  if (docErr) {
    console.error('Error fetching document:', docErr.message);
    return;
  }

  const modelsCovered = doc.models_covered || [];
  console.log('\n1) Primary models (from documents.models_covered):');
  console.log('   ', modelsCovered);

  // Compute exclude_primary
  const excludePrimary = modelsCovered.filter(m => !selectedModels.includes(m));
  console.log('\n   exclude_primary = models_covered - selected_models');
  console.log('   exclude_primary:', excludePrimary);

  // 2. Get ALL detected referenced systems
  const { data: allRefs, error: refErr } = await supabase
    .from('document_referenced_systems')
    .select('canonical_model, user_selected')
    .eq('doc_id', docId);

  if (refErr) {
    console.error('Error fetching refs:', refErr.message);
    return;
  }

  console.log('\n2) Referenced systems (from document_referenced_systems):');
  if (allRefs.length === 0) {
    console.log('   (none found)');
  } else {
    for (const ref of allRefs) {
      console.log(`   ${ref.canonical_model}: user_selected=${ref.user_selected}`);
    }
  }

  // Compute exclude_referenced
  const detectedRefs = allRefs.map(r => r.canonical_model);
  const excludeReferenced = allRefs
    .filter(r => !r.user_selected)
    .map(r => r.canonical_model);

  console.log('\n   exclude_referenced = detected_refs WHERE user_selected=false');
  console.log('   exclude_referenced:', excludeReferenced);

  // 3. Combined exclude list
  const excludeModels = [...excludePrimary, ...excludeReferenced];
  console.log('\n3) Combined exclude list for DIP prompt:');
  console.log('   exclude_models:', excludeModels);

  // 4. Show what the DIP prompt exclude section would look like
  console.log('\n=== DIP PROMPT EXCLUDE SECTION ===\n');
  if (excludeModels.length > 0) {
    console.log('EXCLUDE content SPECIFIC to systems user does NOT have:');
    for (const model of excludeModels) {
      console.log(`- ${model} specific content`);
    }
  } else {
    console.log('(No exclusions - user has all detected systems)');
  }

  // 5. Warning if referenced systems are incomplete
  console.log('\n=== GAPS ===');
  const userSelectedRefs = allRefs.filter(r => r.user_selected).map(r => r.canonical_model);
  const notSelectedRefs = allRefs.filter(r => !r.user_selected).map(r => r.canonical_model);

  console.log('User-selected refs stored:', userSelectedRefs.length > 0 ? userSelectedRefs : '(none)');
  console.log('Detected-but-not-selected refs stored:', notSelectedRefs.length > 0 ? notSelectedRefs : '(none)');

  if (notSelectedRefs.length === 0 && userSelectedRefs.length > 0) {
    console.log('\n⚠️  WARNING: No non-selected refs stored.');
    console.log('   This doc was ingested before migration 044.');
    console.log('   Re-run document ingest to capture all detected refs.');
  }
}

computeExcludeLists().catch(console.error);
