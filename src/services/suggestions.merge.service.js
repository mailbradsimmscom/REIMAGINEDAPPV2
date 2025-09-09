import { logger } from '../utils/logger.js';
import { getSupabaseClient } from '../repositories/supabaseClient.js';

/**
 * Service to merge approved suggestions into production tables
 * This is the missing piece that connects suggestion approval to actual system behavior
 */
class SuggestionsMergeService {
  constructor() {
    this.requestLogger = logger.createRequestLogger();
  }

  /**
   * Merge approved spec suggestions into systems.spec_keywords
   * @param {string} docId - Document ID
   * @param {Array} specSuggestions - Approved spec suggestions
   * @returns {Promise<Object>} Merge result
   */
  async mergeSpecSuggestions(docId, specSuggestions) {
    try {
      const supabase = await getSupabaseClient();
      
      if (!specSuggestions || specSuggestions.length === 0) {
        return { merged: 0, errors: [] };
      }

      const results = { merged: 0, errors: [] };

      for (const suggestion of specSuggestions) {
        try {
          // Get the system for this document
          const { data: document, error: docError } = await supabase
            .from('documents')
            .select('asset_uid, system_norm')
            .eq('doc_id', docId)
            .single();

          if (docError || !document) {
            results.errors.push(`Document not found for doc_id: ${docId}`);
            continue;
          }

          // Get the system record
          const { data: system, error: systemError } = await supabase
            .from('systems')
            .select('spec_keywords_jsonb')
            .eq('asset_uid', document.asset_uid)
            .single();

          if (systemError || !system) {
            results.errors.push(`System not found for asset_uid: ${document.asset_uid}`);
            continue;
          }

          // Merge spec suggestion into spec_keywords JSONB
          const currentSpecs = system.spec_keywords_jsonb || {};
          const hintType = suggestion.hint_type || suggestion.key;
          const specValue = {
            value: suggestion.value,
            unit: suggestion.unit,
            confidence: suggestion.confidence,
            page: suggestion.page,
            context: suggestion.context,
            approved_at: suggestion.approved_at,
            approved_by: suggestion.approved_by,
            doc_id: docId
          };

          // Add or update the spec keyword
          currentSpecs[hintType] = specValue;

          // Update the system record
          const { error: updateError } = await supabase
            .from('systems')
            .update({ 
              spec_keywords_jsonb: currentSpecs,
              updated_at: new Date().toISOString()
            })
            .eq('asset_uid', document.asset_uid);

          if (updateError) {
            results.errors.push(`Failed to update system spec_keywords: ${updateError.message}`);
          } else {
            results.merged++;
            this.requestLogger.info('Spec suggestion merged to production', {
              docId,
              assetUid: document.asset_uid,
              hintType,
              value: suggestion.value
            });
          }

        } catch (error) {
          results.errors.push(`Failed to merge spec suggestion: ${error.message}`);
        }
      }

      return results;

    } catch (error) {
      this.requestLogger.error('Failed to merge spec suggestions', {
        error: error.message,
        docId
      });
      throw error;
    }
  }

  /**
   * Merge approved entity candidates into systems.synonyms
   * @param {string} docId - Document ID
   * @param {Array} entityCandidates - Approved entity candidates
   * @returns {Promise<Object>} Merge result
   */
  async mergeEntityCandidates(docId, entityCandidates) {
    try {
      const supabase = await getSupabaseClient();
      
      if (!entityCandidates || entityCandidates.length === 0) {
        return { merged: 0, errors: [] };
      }

      const results = { merged: 0, errors: [] };

      for (const entity of entityCandidates) {
        try {
          // Get the system for this document
          const { data: document, error: docError } = await supabase
            .from('documents')
            .select('asset_uid, system_norm')
            .eq('doc_id', docId)
            .single();

          if (docError || !document) {
            results.errors.push(`Document not found for doc_id: ${docId}`);
            continue;
          }

          // Get the system record
          const { data: system, error: systemError } = await supabase
            .from('systems')
            .select('synonyms_jsonb')
            .eq('asset_uid', document.asset_uid)
            .single();

          if (systemError || !system) {
            results.errors.push(`System not found for asset_uid: ${document.asset_uid}`);
            continue;
          }

          // Merge entity candidate into synonyms JSONB
          const currentSynonyms = system.synonyms_jsonb || {};
          const entityType = entity.entity_type;
          const entityValue = entity.value;

          // Initialize entity type array if it doesn't exist
          if (!currentSynonyms[entityType]) {
            currentSynonyms[entityType] = [];
          }

          // Add entity if not already present
          const existingEntity = currentSynonyms[entityType].find(
            e => e.value === entityValue
          );

          if (!existingEntity) {
            currentSynonyms[entityType].push({
              value: entityValue,
              confidence: entity.confidence,
              page: entity.page,
              context: entity.context,
              approved_at: entity.approved_at,
              approved_by: entity.approved_by,
              doc_id: docId
            });

            // Update the system record
            const { error: updateError } = await supabase
              .from('systems')
              .update({ 
                synonyms_jsonb: currentSynonyms,
                updated_at: new Date().toISOString()
              })
              .eq('asset_uid', document.asset_uid);

            if (updateError) {
              results.errors.push(`Failed to update system synonyms: ${updateError.message}`);
            } else {
              results.merged++;
              this.requestLogger.info('Entity candidate merged to production', {
                docId,
                assetUid: document.asset_uid,
                entityType,
                value: entityValue
              });
            }
          }

        } catch (error) {
          results.errors.push(`Failed to merge entity candidate: ${error.message}`);
        }
      }

      return results;

    } catch (error) {
      this.requestLogger.error('Failed to merge entity candidates', {
        error: error.message,
        docId
      });
      throw error;
    }
  }

  /**
   * Merge approved playbook hints into playbooks table
   * @param {string} docId - Document ID
   * @param {Array} playbookHints - Approved playbook hints
   * @returns {Promise<Object>} Merge result
   */
  async mergePlaybookHints(docId, playbookHints) {
    try {
      const supabase = await getSupabaseClient();
      
      if (!playbookHints || playbookHints.length === 0) {
        return { merged: 0, errors: [] };
      }

      const results = { merged: 0, errors: [] };

      for (const hint of playbookHints) {
        try {
          // Get the system for this document
          const { data: document, error: docError } = await supabase
            .from('documents')
            .select('asset_uid, system_norm')
            .eq('doc_id', docId)
            .single();

          if (docError || !document) {
            results.errors.push(`Document not found for doc_id: ${docId}`);
            continue;
          }

          // Insert playbook hint into playbooks table
          const { error: insertError } = await supabase
            .from('playbooks')
            .insert({
              title: hint.test_name || hint.description || 'Generated Playbook',
              system_norm: document.system_norm,
              subsystem_norm: document.subsystem_norm,
              doc_id: docId,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              created_by: hint.approved_by || 'admin'
            });

          if (insertError) {
            results.errors.push(`Failed to insert playbook hint: ${insertError.message}`);
          } else {
            results.merged++;
            this.requestLogger.info('Playbook hint merged to production', {
              docId,
              assetUid: document.asset_uid,
              testName: hint.test_name,
              testType: hint.test_type
            });
          }

        } catch (error) {
          results.errors.push(`Failed to merge playbook hint: ${error.message}`);
        }
      }

      return results;

    } catch (error) {
      this.requestLogger.error('Failed to merge playbook hints', {
        error: error.message,
        docId
      });
      throw error;
    }
  }

  /**
   * Merge all approved suggestions into production tables
   * @param {string} docId - Document ID
   * @param {Object} approvedSuggestions - All approved suggestions
   * @returns {Promise<Object>} Complete merge result
   */
  async mergeAllSuggestions(docId, approvedSuggestions) {
    try {
      this.requestLogger.info('Starting suggestions merge to production', { docId });

      const results = {
        doc_id: docId,
        spec_suggestions: { merged: 0, errors: [] },
        entity_candidates: { merged: 0, errors: [] },
        playbook_hints: { merged: 0, errors: [] },
        total_merged: 0,
        total_errors: 0
      };

      // Merge spec suggestions
      if (approvedSuggestions.spec_suggestions && approvedSuggestions.spec_suggestions.length > 0) {
        const specResult = await this.mergeSpecSuggestions(docId, approvedSuggestions.spec_suggestions);
        results.spec_suggestions = specResult;
        results.total_merged += specResult.merged;
        results.total_errors += specResult.errors.length;
      }

      // Merge entity candidates
      if (approvedSuggestions.entities && approvedSuggestions.entities.length > 0) {
        const entityResult = await this.mergeEntityCandidates(docId, approvedSuggestions.entities);
        results.entity_candidates = entityResult;
        results.total_merged += entityResult.merged;
        results.total_errors += entityResult.errors.length;
      }

      // Merge playbook hints
      if (approvedSuggestions.playbook_hints && approvedSuggestions.playbook_hints.length > 0) {
        const playbookResult = await this.mergePlaybookHints(docId, approvedSuggestions.playbook_hints);
        results.playbook_hints = playbookResult;
        results.total_merged += playbookResult.merged;
        results.total_errors += playbookResult.errors.length;
      }

      this.requestLogger.info('Suggestions merge completed', {
        docId,
        totalMerged: results.total_merged,
        totalErrors: results.total_errors
      });

      return results;

    } catch (error) {
      this.requestLogger.error('Failed to merge all suggestions', {
        error: error.message,
        docId
      });
      throw error;
    }
  }
}

export default new SuggestionsMergeService();
