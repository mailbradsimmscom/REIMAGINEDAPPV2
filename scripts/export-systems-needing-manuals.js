import 'dotenv/config';
import { getSupabaseClient } from '../src/repositories/supabaseClient.js';
import { writeFileSync } from 'fs';

/**
 * Export systems that need manuals
 * Excludes systems that:
 * 1. Already have manual_url
 * 2. Have documents uploaded
 */

async function exportSystemsNeedingManuals() {
  try {
    const supabase = await getSupabaseClient();

    console.log('\n=== EXPORTING SYSTEMS NEEDING MANUALS ===\n');

    // Get all systems where manual != true
    const { data: systemsWithoutManuals, error: systemsError } = await supabase
      .from('systems')
      .select('asset_uid, manufacturer_norm, model_norm, system_norm, subsystem_norm, description, manual')
      .or('manual.is.null,manual.eq.false')
      .order('manufacturer_norm');

    if (systemsError) throw systemsError;

    console.log(`Found ${systemsWithoutManuals.length} systems where manual != true`);

    // Get all systems that have documents
    const { data: systemsWithDocs, error: docsError } = await supabase
      .from('documents')
      .select('asset_uid')
      .not('asset_uid', 'is', null);

    if (docsError) throw docsError;

    const systemsWithDocsSet = new Set(
      systemsWithDocs.map(doc => doc.asset_uid)
    );

    console.log(`Found ${systemsWithDocsSet.size} unique systems with uploaded documents`);

    // Filter out systems that have documents
    const systemsNeedingManuals = systemsWithoutManuals.filter(
      sys => !systemsWithDocsSet.has(sys.asset_uid)
    );

    console.log(`\n✅ ${systemsNeedingManuals.length} systems need manuals\n`);

    // Generate CSV
    const csvHeader = 'asset_uid,manufacturer_norm,model_norm,system_norm,subsystem_norm,description\n';
    const csvRows = systemsNeedingManuals.map(sys => {
      const desc = (sys.description || '').replace(/"/g, '""'); // Escape quotes
      return `${sys.asset_uid},${sys.manufacturer_norm},${sys.model_norm},${sys.system_norm},${sys.subsystem_norm},"${desc}"`;
    }).join('\n');

    const csv = csvHeader + csvRows;
    const outputPath = 'scripts/agents/systems-needing-manuals.csv';

    writeFileSync(outputPath, csv, 'utf-8');

    console.log(`✅ Exported to: ${outputPath}`);
    console.log(`\nSample records:`);
    systemsNeedingManuals.slice(0, 5).forEach((sys, i) => {
      console.log(`${i + 1}. ${sys.manufacturer_norm} ${sys.model_norm}`);
      console.log(`   System: ${sys.system_norm} / ${sys.subsystem_norm}`);
    });

    console.log(`\n... and ${systemsNeedingManuals.length - 5} more\n`);

  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }

  process.exit(0);
}

exportSystemsNeedingManuals();
