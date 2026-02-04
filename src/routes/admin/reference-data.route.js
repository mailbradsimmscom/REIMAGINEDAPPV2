import express from 'express';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { logger } from '../../utils/logger.js';
import { generateRefTableSynonyms } from '../../services/keywords-synonyms-generation.service.js';

const router = express.Router();

// POST /admin/api/reference-data - Add a new reference table entry
router.post('/', async (req, res) => {
  try {
    const { type, name, parent_system } = req.body;

    if (!type || !name) {
      return res.status(400).json({
        success: false,
        error: { message: 'type and name are required' }
      });
    }

    const supabase = await getSupabaseClient();
    let result;

    switch (type) {
      case 'manufacturer': {
        const { data, error } = await supabase
          .from('ref_manufacturers')
          .insert({ name: name.trim() })
          .select()
          .single();

        if (error) {
          if (error.code === '23505') {
            return res.status(409).json({
              success: false,
              error: { message: `Manufacturer "${name}" already exists` }
            });
          }
          throw error;
        }
        result = data;
        break;
      }

      case 'product_type': {
        const { data, error } = await supabase
          .from('ref_product_types')
          .insert({ name: name.trim() })
          .select()
          .single();

        if (error) {
          if (error.code === '23505') {
            return res.status(409).json({
              success: false,
              error: { message: `Product type "${name}" already exists` }
            });
          }
          throw error;
        }
        result = data;
        break;
      }

      case 'system_category': {
        // Get next display_order
        const { data: maxOrder } = await supabase
          .from('ref_system_categories')
          .select('display_order')
          .order('display_order', { ascending: false })
          .limit(1)
          .single();

        const nextOrder = (maxOrder?.display_order ?? 0) + 1;

        const { data, error } = await supabase
          .from('ref_system_categories')
          .insert({
            name: name.trim(),
            display_order: nextOrder
          })
          .select()
          .single();

        if (error) {
          if (error.code === '23505') {
            return res.status(409).json({
              success: false,
              error: { message: `System category "${name}" already exists` }
            });
          }
          throw error;
        }
        result = data;
        break;
      }

      case 'subsystem_category': {
        if (!parent_system) {
          return res.status(400).json({
            success: false,
            error: { message: 'parent_system is required for subsystem_category' }
          });
        }

        // Look up system_id from name
        const { data: systemData, error: systemError } = await supabase
          .from('ref_system_categories')
          .select('id')
          .eq('name', parent_system)
          .single();

        if (systemError || !systemData) {
          return res.status(400).json({
            success: false,
            error: { message: `System category "${parent_system}" not found` }
          });
        }

        // Get next display_order for this system
        const { data: maxOrder } = await supabase
          .from('ref_subsystem_categories')
          .select('display_order')
          .eq('system_id', systemData.id)
          .order('display_order', { ascending: false })
          .limit(1)
          .single();

        const nextOrder = (maxOrder?.display_order ?? 0) + 1;

        const { data, error } = await supabase
          .from('ref_subsystem_categories')
          .insert({
            name: name.trim(),
            system_id: systemData.id,
            display_order: nextOrder
          })
          .select()
          .single();

        if (error) {
          if (error.code === '23505') {
            return res.status(409).json({
              success: false,
              error: { message: `Subsystem "${name}" already exists under "${parent_system}"` }
            });
          }
          throw error;
        }
        result = data;
        break;
      }

      default:
        return res.status(400).json({
          success: false,
          error: { message: `Unknown type: ${type}. Valid types: manufacturer, product_type, system_category, subsystem_category` }
        });
    }

    logger.info('Reference data added', { type, name, id: result.id });

    // Auto-enrich with LLM-generated synonyms and description
    const tableMap = {
      manufacturer: 'ref_manufacturers',
      product_type: 'ref_product_types',
      system_category: 'ref_system_categories',
      subsystem_category: 'ref_subsystem_categories'
    };
    const dbTable = tableMap[type];

    if (dbTable && result.id) {
      try {
        const enrichment = await generateRefTableSynonyms(type, name.trim());

        if (enrichment.synonyms.length > 0 || enrichment.description) {
          const updateData = {};
          if (enrichment.synonyms.length > 0) updateData.synonyms = enrichment.synonyms;
          if (enrichment.description) updateData.description = enrichment.description;

          const { error: enrichError } = await supabase
            .from(dbTable)
            .update(updateData)
            .eq('id', result.id);

          if (enrichError) {
            logger.warn('Failed to enrich ref table entry', { type, name, error: enrichError.message });
          } else {
            Object.assign(result, updateData);
            logger.info('Ref table entry enriched', { type, name, synonymsCount: enrichment.synonyms.length });
          }
        }
      } catch (enrichErr) {
        logger.warn('LLM enrichment failed for ref table entry', { type, name, error: enrichErr.message });
      }
    }

    return res.json({
      success: true,
      data: result
    });

  } catch (error) {
    logger.error('Error adding reference data', { error: error.message });
    return res.status(500).json({
      success: false,
      error: { message: error.message }
    });
  }
});

export default router;
