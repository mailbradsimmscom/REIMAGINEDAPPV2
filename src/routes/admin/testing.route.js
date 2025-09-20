import { Router } from 'express';
import { adminOnly } from '../../middleware/admin.js';
import { logger } from '../../utils/logger.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';

const router = Router();

// Get dashboard overview data for all staging tables
router.get('/dashboard', adminOnly, async (req, res) => {
  try {
    const supabaseClient = await getSupabaseClient();
    
    // Fetch counts and breakdowns from all staging tables
    const [specSuggestions, playbookHints, intentRouter, goldenTests] = await Promise.all([
      supabaseClient
        .from('staging_spec_suggestions')
        .select('doc_id, manufacturer_norm, model_norm, created_at')
        .eq('status', 'pending'),
      
      supabaseClient
        .from('staging_playbook_hints')
        .select('doc_id, manufacturer_norm, model_norm, created_at')
        .eq('status', 'pending'),
      
      supabaseClient
        .from('staging_intent_router')
        .select('doc_id, manufacturer_norm, model_norm, created_at')
        .eq('status', 'pending'),
      
      supabaseClient
        .from('staging_golden_tests')
        .select('doc_id, manufacturer_norm, model_norm, created_at')
        .eq('status', 'pending')
    ]);

    // Check for errors
    const errors = [specSuggestions.error, playbookHints.error, intentRouter.error, goldenTests.error]
      .filter(error => error);
    
    if (errors.length > 0) {
      logger.error('Failed to fetch staging dashboard data', { errors });
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to fetch staging data' }
      });
    }

    // Process data for each table
    const processTableData = (data, tableName) => {
      const total = data.length;
      const byModel = {};
      const byManufacturer = {};
      let lastUpdated = null;

      data.forEach(item => {
        // Count by model
        const model = item.model_norm || 'Unknown';
        byModel[model] = (byModel[model] || 0) + 1;
        
        // Count by manufacturer
        const manufacturer = item.manufacturer_norm || 'Unknown';
        byManufacturer[manufacturer] = (byManufacturer[manufacturer] || 0) + 1;
        
        // Track last updated
        if (item.created_at) {
          const created = new Date(item.created_at);
          if (!lastUpdated || created > lastUpdated) {
            lastUpdated = created;
          }
        }
      });

      return {
        total,
        by_model: byModel,
        by_manufacturer: byManufacturer,
        last_updated: lastUpdated?.toISOString()
      };
    };

    const dashboardData = {
      specifications: processTableData(specSuggestions.data, 'specifications'),
      playbook_hints: processTableData(playbookHints.data, 'playbook_hints'),
      intent_router: processTableData(intentRouter.data, 'intent_router'),
      golden_tests: processTableData(goldenTests.data, 'golden_tests')
    };

    logger.info('Fetched staging dashboard data', {
      specifications: dashboardData.specifications.total,
      playbook_hints: dashboardData.playbook_hints.total,
      intent_router: dashboardData.intent_router.total,
      golden_tests: dashboardData.golden_tests.total
    });

    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    logger.error('Failed to fetch staging dashboard data', { error: error.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch staging data' }
    });
  }
});

// Get detailed data for a specific staging table
router.get('/:table', adminOnly, async (req, res) => {
  try {
    const { table } = req.params;
    const { docId, page = 1, limit = 50 } = req.query;
    
    // Validate table name
    const validTables = ['specifications', 'playbook', 'intent-router', 'golden-tests'];
    if (!validTables.includes(table)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_TABLE', message: 'Invalid table name' }
      });
    }

    // Map table names to actual database table names
    const tableMap = {
      'specifications': 'staging_spec_suggestions',
      'playbook': 'staging_playbook_hints',
      'intent-router': 'staging_intent_router',
      'golden-tests': 'staging_golden_tests'
    };

    const dbTable = tableMap[table];
    const supabaseClient = await getSupabaseClient();
    
    // Build query
    let query = supabaseClient
      .from(dbTable)
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    // Add document filter if specified
    if (docId) {
      query = query.eq('doc_id', docId);
    }

    // Add pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      logger.error(`Failed to fetch ${table} data`, { error: error.message });
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: `Failed to fetch ${table} data` }
      });
    }

    logger.info(`Fetched ${table} data`, { 
      count: data?.length || 0,
      total: count,
      page,
      limit
    });

    res.json({
      success: true,
      data: {
        items: data || [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        }
      }
    });

  } catch (error) {
    logger.error(`Failed to fetch ${req.params.table} data`, { error: error.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch table data' }
    });
  }
});

// Approve selected items from staging to production
router.post('/:table/approve', adminOnly, async (req, res) => {
  try {
    const { table } = req.params;
    const { itemIds } = req.body;
    
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'itemIds array is required' }
      });
    }

    // Map table names to actual database table names
    const tableMap = {
      'specifications': 'staging_spec_suggestions',
      'playbook': 'staging_playbook_hints',
      'intent-router': 'staging_intent_router',
      'golden-tests': 'staging_golden_tests'
    };

    const dbTable = tableMap[table];
    if (!dbTable) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_TABLE', message: 'Invalid table name' }
      });
    }

    const supabaseClient = await getSupabaseClient();
    
    // Fetch the items to approve
    const { data: itemsToApprove, error: fetchError } = await supabaseClient
      .from(dbTable)
      .select('*')
      .in('id', itemIds)
      .eq('status', 'pending');

    if (fetchError) {
      logger.error(`Failed to fetch items for approval`, { error: fetchError.message });
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to fetch items for approval' }
      });
    }

    if (!itemsToApprove || itemsToApprove.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'No pending items found for approval' }
      });
    }

    // Implement the actual approval logic
    let approvedCount = 0;
    const errors = [];

    for (const item of itemsToApprove) {
      try {
        // Map staging fields to production table fields based on table type
        let productionData;
        let productionTable;

        switch (table) {
          case 'specifications':
            productionTable = 'spec_suggestions';
            productionData = {
              doc_id: item.doc_id,
              hint_type: item.parameter || 'specification',
              value: item.value,
              unit: item.units,
              page: item.page,
              context: item.description,
              confidence: item.confidence,
              bbox: item.bbox
            };
            break;

          case 'playbook':
            productionTable = 'playbook_hints';
            productionData = {
              doc_id: item.doc_id,
              test_name: item.title,
              test_type: item.category || 'procedure',
              description: item.description,
              steps: item.steps,
              expected_result: item.expected_outcome,
              page: item.page,
              confidence: item.confidence,
              bbox: item.bbox
            };
            break;

          case 'intent-router':
            productionTable = 'intent_hints';
            productionData = {
              doc_id: item.doc_id,
              intent_type: item.question_type || 'question',
              prompt: item.question,
              context: item.description,
              page: item.page,
              confidence: item.confidence,
              bbox: item.bbox
            };
            break;

          case 'golden-tests':
            // For golden tests, we'll insert into a new golden_tests table
            productionTable = 'golden_tests';
            productionData = {
              doc_id: item.doc_id,
              query: item.query,
              expected: item.expected,
              test_method: item.test_method,
              failure_indication: item.failure_indication,
              related_procedures: item.related_procedures,
              description: item.description,
              page: item.page,
              confidence: item.confidence,
              bbox: item.bbox
            };
            break;

          default:
            throw new Error(`Unknown table type: ${table}`);
        }

        // Insert into production table
        const { error: insertError } = await supabaseClient
          .from(productionTable)
          .insert(productionData);

        if (insertError) {
          logger.error(`Failed to insert into ${productionTable}`, { 
            error: insertError.message, 
            itemId: item.id 
          });
          errors.push(`Failed to insert item ${item.id}: ${insertError.message}`);
          continue;
        }

        // Update staging item status to approved
        const { error: updateError } = await supabaseClient
          .from(dbTable)
          .update({ 
            status: 'approved'
          })
          .eq('id', item.id);

        if (updateError) {
          logger.error(`Failed to update staging item status`, { 
            error: updateError.message, 
            itemId: item.id 
          });
          errors.push(`Failed to update staging item ${item.id}: ${updateError.message}`);
          continue;
        }

        approvedCount++;

      } catch (error) {
        logger.error(`Error processing item ${item.id}`, { error: error.message });
        errors.push(`Error processing item ${item.id}: ${error.message}`);
      }
    }

    logger.info(`Approved ${approvedCount} items from ${table}`, {
      table,
      itemIds,
      approvedCount,
      errors: errors.length
    });

    res.json({
      success: true,
      data: {
        approved_count: approvedCount,
        total_requested: itemsToApprove.length,
        errors: errors,
        message: `Successfully approved ${approvedCount} of ${itemsToApprove.length} items from ${table}`
      }
    });

  } catch (error) {
    logger.error(`Failed to approve ${req.params.table} items`, { error: error.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to approve items' }
    });
  }
});

// Decline items endpoint
router.post('/:table/decline', adminOnly, async (req, res) => {
  try {
    const { table } = req.params;
    const { itemIds, declineReason } = req.body;

    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'itemIds array is required' }
      });
    }

    // Map table names to actual database table names
    const tableMap = {
      'specifications': 'staging_spec_suggestions',
      'playbook': 'staging_playbook_hints',
      'intent-router': 'staging_intent_router',
      'golden-tests': 'staging_golden_tests'
    };

    const declinedTableMap = {
      'specifications': 'declined_spec_suggestions',
      'playbook': 'declined_playbook_hints',
      'intent-router': 'declined_intent_router',
      'golden-tests': 'declined_golden_tests'
    };

    const dbTable = tableMap[table];
    const declinedTable = declinedTableMap[table];
    
    if (!dbTable || !declinedTable) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_TABLE', message: 'Invalid table name' }
      });
    }

    const supabaseClient = await getSupabaseClient();
    
    // Fetch the items to decline
    const { data: itemsToDecline, error: fetchError } = await supabaseClient
      .from(dbTable)
      .select('*')
      .in('id', itemIds)
      .eq('status', 'pending');

    if (fetchError) {
      logger.error(`Failed to fetch items for decline`, { error: fetchError.message });
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to fetch items for decline' }
      });
    }

    if (!itemsToDecline || itemsToDecline.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'No pending items found for decline' }
      });
    }

    // Implement the actual decline logic
    let declinedCount = 0;
    const errors = [];

    for (const item of itemsToDecline) {
      try {
        // Prepare declined item data (copy all fields plus decline tracking)
        const declinedData = {
          ...item,
          declined_at: new Date().toISOString(),
          declined_by: req.user?.email || 'admin',
          decline_reason: declineReason || 'No reason provided'
        };

        // Keep the original id to maintain audit trail
        // (don't delete declinedData.id)

        // Insert into declined table
        const { error: insertError } = await supabaseClient
          .from(declinedTable)
          .insert(declinedData);

        if (insertError) {
          logger.error(`Failed to insert into ${declinedTable}`, {
            error: insertError.message,
            itemId: item.id
          });
          errors.push(`Failed to insert item ${item.id}: ${insertError.message}`);
          continue;
        }

        // Update staging item status to declined
        const { error: updateError } = await supabaseClient
          .from(dbTable)
          .update({
            status: 'declined'
          })
          .eq('id', item.id);

        if (updateError) {
          logger.error(`Failed to update staging item status`, {
            error: updateError.message,
            itemId: item.id
          });
          errors.push(`Failed to update staging item ${item.id}: ${updateError.message}`);
          continue;
        }

        declinedCount++;

      } catch (error) {
        logger.error(`Error processing item ${item.id}`, { error: error.message });
        errors.push(`Error processing item ${item.id}: ${error.message}`);
      }
    }

    logger.info(`Declined ${declinedCount} items from ${table}`, {
      table,
      itemIds,
      declinedCount,
      errors: errors.length
    });

    res.json({
      success: true,
      data: {
        declined_count: declinedCount,
        total_requested: itemsToDecline.length,
        errors: errors,
        message: `Successfully declined ${declinedCount} of ${itemsToDecline.length} items from ${table}`
      }
    });

  } catch (error) {
    logger.error(`Failed to decline ${req.params.table} items`, { error: error.message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to decline items' }
    });
  }
});

export default router;
