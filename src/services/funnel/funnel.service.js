/**
 * Funnel Service
 * Gathers statistics across the system → document → processing pipeline
 */

import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { Pinecone } from '@pinecone-database/pinecone';
import { getEnv } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const requestLogger = logger.createRequestLogger();

/**
 * Get count from a table with optional filter
 */
async function getCount(table, filter = null) {
  const supabase = await getSupabaseClient();
  let query = supabase.from(table).select('*', { count: 'exact', head: true });

  if (filter) {
    Object.entries(filter).forEach(([key, value]) => {
      if (value === null) {
        query = query.is(key, null);
      } else if (value === 'NOT_NULL') {
        query = query.not(key, 'is', null);
      } else {
        query = query.eq(key, value);
      }
    });
  }

  const { count, error } = await query;
  if (error) {
    requestLogger.warn(`Failed to count ${table}`, { error: error.message });
    return 0;
  }
  return count || 0;
}

/**
 * Get systems with documents (from documents table, source of truth)
 */
async function getSystemsWithDocuments() {
  const supabase = await getSupabaseClient();

  // Get unique asset_uids from documents table
  const { data: docs, error } = await supabase
    .from('documents')
    .select('asset_uid')
    .not('asset_uid', 'is', null);

  if (error) {
    requestLogger.warn('Failed to get document asset_uids', { error: error.message });
    return { count: 0, uniqueAssetUids: [] };
  }

  const uniqueAssetUids = [...new Set(docs.map(d => d.asset_uid))];
  return { count: uniqueAssetUids.length, uniqueAssetUids };
}

/**
 * Find data inconsistencies between systems and documents
 */
async function getDataIssues() {
  const supabase = await getSupabaseClient();
  const issues = [];

  // Get systems with Manual_Local_Copy=true
  const { data: flaggedSystems } = await supabase
    .from('systems')
    .select('asset_uid, manufacturer_norm, model_norm')
    .eq('Manual_Local_Copy', true);

  // Get document asset_uids
  const { data: docs } = await supabase.from('documents').select('asset_uid');
  const docAssetUids = new Set(docs.map(d => d.asset_uid));

  // Systems with flag but no document
  const orphanedFlag = flaggedSystems.filter(s => !docAssetUids.has(s.asset_uid));
  orphanedFlag.forEach(s => {
    issues.push({
      type: 'flag_no_doc',
      message: `${s.manufacturer_norm} / ${s.model_norm} has Manual_Local_Copy=true but no document`,
      asset_uid: s.asset_uid
    });
  });

  // Systems with documents but no flag
  const uniqueDocUids = [...new Set(docs.map(d => d.asset_uid))];
  const { data: systemsForDocs } = await supabase
    .from('systems')
    .select('asset_uid, manufacturer_norm, model_norm, Manual_Local_Copy')
    .in('asset_uid', uniqueDocUids);

  const missingFlag = systemsForDocs.filter(s => s.Manual_Local_Copy !== true);
  missingFlag.forEach(s => {
    issues.push({
      type: 'doc_no_flag',
      message: `${s.manufacturer_norm} / ${s.model_norm} has document but Manual_Local_Copy != true`,
      asset_uid: s.asset_uid
    });
  });

  return issues;
}

/**
 * Get counts grouped by a column
 */
async function getGroupedCounts(table, groupByColumn) {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.from(table).select(groupByColumn);

  if (error) {
    requestLogger.warn(`Failed to get grouped counts from ${table}`, { error: error.message });
    return {};
  }

  const counts = {};
  (data || []).forEach(row => {
    const key = row[groupByColumn] || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

/**
 * Get Pinecone vector statistics
 */
async function getPineconeStats() {
  try {
    const env = getEnv();
    if (!env.PINECONE_API_KEY) {
      return { total: 0, namespaces: {}, error: 'No API key' };
    }

    const pc = new Pinecone({ apiKey: env.PINECONE_API_KEY });
    const index = pc.index(env.PINECONE_INDEX || 'reimaginedsv');
    const stats = await index.describeIndexStats();

    const namespaces = {};
    if (stats.namespaces) {
      Object.entries(stats.namespaces).forEach(([ns, data]) => {
        namespaces[ns] = data.recordCount || 0;
      });
    }

    return {
      total: stats.totalRecordCount || 0,
      namespaces
    };
  } catch (error) {
    requestLogger.warn('Failed to get Pinecone stats', { error: error.message });
    return { total: 0, namespaces: {}, error: error.message };
  }
}

/**
 * Get all rows from a table with pagination (Supabase limit is 1000)
 */
async function getAllRows(table, selectColumns) {
  const supabase = await getSupabaseClient();
  let allData = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(selectColumns)
      .range(offset, offset + pageSize - 1);

    if (error) {
      requestLogger.warn(`Failed to get rows from ${table}`, { error: error.message });
      break;
    }
    if (!data || data.length === 0) break;

    allData = allData.concat(data);
    offset += pageSize;
    if (data.length < pageSize) break;
  }

  return allData;
}

/**
 * Get DIP staging statistics across all 4 staging tables
 */
async function getDipStagingStats() {
  const tables = [
    'staging_spec_suggestions',
    'staging_playbook_hints',
    'staging_intent_router',
    'staging_golden_tests'
  ];

  // Collect stats by asset_uid across all tables
  const systemStats = {};
  const tableStats = {};

  for (const table of tables) {
    const tableName = table.replace('staging_', '');
    const rows = await getAllRows(table, 'asset_uid, status');

    tableStats[tableName] = { pending: 0, approved: 0, declined: 0, total: 0 };

    rows.forEach(row => {
      const status = row.status || 'pending';

      // Table-level stats
      tableStats[tableName][status] = (tableStats[tableName][status] || 0) + 1;
      tableStats[tableName].total++;

      // System-level stats
      if (row.asset_uid) {
        if (!systemStats[row.asset_uid]) {
          systemStats[row.asset_uid] = { pending: 0, approved: 0, declined: 0 };
        }
        systemStats[row.asset_uid][status] = (systemStats[row.asset_uid][status] || 0) + 1;
      }
    });
  }

  // Calculate system-level summary
  const systemList = Object.keys(systemStats);
  let systemsFullyApproved = 0;
  let systemsPartiallyReviewed = 0;
  let systemsAllPending = 0;

  for (const sysId of systemList) {
    const s = systemStats[sysId];
    if (s.pending === 0 && (s.approved > 0 || s.declined > 0)) {
      systemsFullyApproved++;
    } else if (s.approved > 0 || s.declined > 0) {
      systemsPartiallyReviewed++;
    } else {
      systemsAllPending++;
    }
  }

  // Calculate totals
  let totalPending = 0, totalApproved = 0, totalDeclined = 0;
  Object.values(tableStats).forEach(t => {
    totalPending += t.pending;
    totalApproved += t.approved;
    totalDeclined += t.declined;
  });

  return {
    totalSystems: systemList.length,
    systemsFullyApproved,
    systemsPartiallyReviewed,
    systemsAllPending,
    totalItems: totalPending + totalApproved + totalDeclined,
    totalPending,
    totalApproved,
    totalDeclined,
    byTable: tableStats
  };
}

/**
 * Get live task counts from boatos_tasks and user_tasks
 */
async function getLiveTaskStats() {
  const supabase = await getSupabaseClient();

  try {
    // Get boatos_tasks (system-extracted, approved)
    const { data: boatosTasks, error: e1 } = await supabase
      .from('boatos_tasks')
      .select('id, task_type, asset_uid, is_active');

    // Get user_tasks (manually created)
    const { data: userTasks, error: e2 } = await supabase
      .from('user_tasks')
      .select('id, description, asset_uid, status, is_recurring, frequency_basis, priority');

    // Get task_completions
    const { count: completionCount } = await supabase
      .from('task_completions')
      .select('*', { count: 'exact', head: true });

    // Aggregate boatos_tasks
    const boatosActive = (boatosTasks || []).filter(t => t.is_active !== false).length;
    const boatosByType = {};
    (boatosTasks || []).forEach(t => {
      const type = t.task_type || 'unknown';
      boatosByType[type] = (boatosByType[type] || 0) + 1;
    });

    // Aggregate user_tasks
    const userActive = (userTasks || []).filter(t => t.status === 'active').length;
    const userByStatus = {};
    const userByPriority = {};
    const userRecurring = (userTasks || []).filter(t => t.is_recurring).length;
    (userTasks || []).forEach(t => {
      const status = t.status || 'unknown';
      userByStatus[status] = (userByStatus[status] || 0) + 1;
      const priority = t.priority || 'normal';
      userByPriority[priority] = (userByPriority[priority] || 0) + 1;
    });

    return {
      boatosTasks: {
        total: boatosTasks?.length || 0,
        active: boatosActive,
        byType: boatosByType
      },
      userTasks: {
        total: userTasks?.length || 0,
        active: userActive,
        recurring: userRecurring,
        byStatus: userByStatus,
        byPriority: userByPriority
      },
      completions: completionCount || 0
    };
  } catch (error) {
    requestLogger.warn('Failed to get live task stats', { error: error.message });
    return {
      boatosTasks: { total: 0, active: 0, byType: {} },
      userTasks: { total: 0, active: 0, recurring: 0, byStatus: {}, byPriority: {} },
      completions: 0
    };
  }
}

/**
 * Get Maintenance Agent statistics from maintenance_tasks_index
 */
async function getMaintenanceAgentStats() {
  const supabase = await getSupabaseClient();

  try {
    // Get all tasks from maintenance_tasks_index
    const { data: tasks, error } = await supabase
      .from('maintenance_tasks_index')
      .select('review_status, asset_uid, task_category, frequency_basis, system_name');

    if (error) {
      requestLogger.warn('Failed to get maintenance_tasks_index', { error: error.message });
      return {
        totalTasks: 0,
        systemsWithTasks: 0,
        byStatus: {},
        byCategory: {},
        byFrequencyBasis: {},
        approvedBySystem: {}
      };
    }

    // Aggregate stats
    const byStatus = {};
    const byCategory = {};
    const byFrequencyBasis = {};
    const approvedBySystem = {};
    const systemsWithTasks = new Set();

    (tasks || []).forEach(t => {
      // By status
      const status = t.review_status || 'unknown';
      byStatus[status] = (byStatus[status] || 0) + 1;

      // Track unique systems
      if (t.asset_uid) systemsWithTasks.add(t.asset_uid);

      // For approved tasks, track additional breakdowns
      if (status === 'approved') {
        // By category
        const cat = t.task_category || 'unknown';
        byCategory[cat] = (byCategory[cat] || 0) + 1;

        // By frequency basis
        const basis = t.frequency_basis || 'unknown';
        byFrequencyBasis[basis] = (byFrequencyBasis[basis] || 0) + 1;

        // By system name
        const sysName = t.system_name || 'unknown';
        approvedBySystem[sysName] = (approvedBySystem[sysName] || 0) + 1;
      }
    });

    // Get systems searched count from pinecone_search_results
    const { data: searchResults } = await supabase
      .from('pinecone_search_results')
      .select('asset_uid');

    const systemsSearched = new Set((searchResults || []).map(r => r.asset_uid));

    return {
      totalTasks: tasks?.length || 0,
      systemsSearched: systemsSearched.size,
      systemsWithTasks: systemsWithTasks.size,
      byStatus,
      byCategory,
      byFrequencyBasis,
      approvedBySystem
    };
  } catch (error) {
    requestLogger.warn('Failed to get maintenance agent stats', { error: error.message });
    return {
      totalTasks: 0,
      systemsSearched: 0,
      systemsWithTasks: 0,
      byStatus: {},
      byCategory: {},
      byFrequencyBasis: {},
      approvedBySystem: {}
    };
  }
}

/**
 * Get unique systems from document_chunks (systems that have been vectorized)
 */
async function getVectorizedSystemsCount() {
  const supabase = await getSupabaseClient();

  try {
    // Get total count first
    const { count: totalChunks } = await supabase
      .from('document_chunks')
      .select('*', { count: 'exact', head: true });

    // Paginate to get all metadata (Supabase default limit is 1000)
    let allData = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await supabase
        .from('document_chunks')
        .select('metadata')
        .range(offset, offset + pageSize - 1);

      if (error) {
        requestLogger.warn('Failed to get document_chunks', { error: error.message });
        break;
      }
      if (!data || data.length === 0) break;

      allData = allData.concat(data);
      offset += pageSize;
      if (data.length < pageSize) break;
    }

    // Extract unique asset_uids from metadata
    const assetUids = new Set();
    allData.forEach(row => {
      if (row.metadata?.linked_asset_uid) {
        assetUids.add(row.metadata.linked_asset_uid);
      }
    });

    return {
      uniqueSystems: assetUids.size,
      totalChunks: totalChunks || allData.length
    };
  } catch (error) {
    requestLogger.warn('Failed to get vectorized systems count', { error: error.message });
    return { uniqueSystems: 0, totalChunks: 0 };
  }
}

/**
 * Get all funnel statistics
 * @returns {Promise<Object>} Funnel data with all stages
 */
export async function getFunnelStats() {
  const startTime = Date.now();

  // Gather all stats in parallel where possible
  const [
    totalSystems,
    systemsWithDocs,
    totalDocuments,
    documentsInStorage,
    jobsByStatus,
    dipStagingStats,
    maintenanceStats,
    liveTaskStats,
    pineconeStats,
    vectorizedSystems,
    dataIssues
  ] = await Promise.all([
    getCount('systems'),
    getSystemsWithDocuments(),
    getCount('documents'),
    getCount('documents', { storage_path: 'NOT_NULL' }),
    getGroupedCounts('jobs', 'status'),
    getDipStagingStats(),
    getMaintenanceAgentStats(),
    getLiveTaskStats(),
    getPineconeStats(),
    getVectorizedSystemsCount(),
    getDataIssues()
  ]);

  const systemsWithManual = systemsWithDocs.count;

  // Calculate totals
  const totalJobs = Object.values(jobsByStatus).reduce((a, b) => a + b, 0);

  // Shared stages (before the branch point)
  const sharedStages = [
    {
      id: 'systems',
      label: 'Total Systems',
      description: 'Equipment in inventory',
      count: totalSystems,
      icon: '🔧'
    },
    {
      id: 'systems_with_manual',
      label: 'Systems with Manual',
      description: 'Equipment linked to documentation',
      count: systemsWithManual,
      percentage: totalSystems > 0 ? Math.round((systemsWithManual / totalSystems) * 100) : 0,
      icon: '📎'
    },
    {
      id: 'documents',
      label: 'Documents Uploaded',
      description: `PDFs for ${systemsWithManual} systems`,
      count: totalDocuments,
      icon: '📄'
    },
    {
      id: 'documents_storage',
      label: 'Documents in Storage',
      description: 'PDFs uploaded to Supabase Storage',
      count: documentsInStorage,
      percentage: totalDocuments > 0 ? Math.round((documentsInStorage / totalDocuments) * 100) : 0,
      icon: '☁️'
    },
    {
      id: 'ingest_jobs',
      label: 'Ingest Jobs',
      description: 'Document processing jobs',
      count: totalJobs,
      breakdown: jobsByStatus,
      icon: '⚙️'
    },
    {
      id: 'pinecone_vectors',
      label: 'Pinecone Vectors',
      description: `${vectorizedSystems.uniqueSystems} systems vectorized`,
      count: pineconeStats.total,
      breakdown: {
        ...pineconeStats.namespaces,
        'Unique Systems': vectorizedSystems.uniqueSystems
      },
      icon: '🔍',
      isBranchPoint: true
    }
  ];

  // DIP Branch stages
  const dipBranch = {
    id: 'dip',
    label: 'DIP Pipeline',
    description: 'Chat AI enrichment',
    stages: [
      {
        id: 'dip_extractions',
        label: 'DIP Extractions',
        description: `${dipStagingStats.totalSystems} systems processed`,
        count: dipStagingStats.totalItems,
        breakdown: {
          'Pending': dipStagingStats.totalPending,
          'Approved': dipStagingStats.totalApproved,
          'Declined': dipStagingStats.totalDeclined
        },
        dipDetails: {
          systems: {
            total: dipStagingStats.totalSystems,
            fullyApproved: dipStagingStats.systemsFullyApproved,
            partiallyReviewed: dipStagingStats.systemsPartiallyReviewed,
            allPending: dipStagingStats.systemsAllPending
          },
          byTable: dipStagingStats.byTable
        },
        icon: '📊'
      },
      {
        id: 'dip_production',
        label: 'Production Tables',
        description: 'Approved items for Chat AI',
        count: dipStagingStats.totalApproved,
        breakdown: Object.fromEntries(
          Object.entries(dipStagingStats.byTable).map(([table, stats]) => [table, stats.approved || 0])
        ),
        icon: '💬'
      }
    ]
  };

  // Maintenance Branch stages
  const approvedCount = maintenanceStats.byStatus.approved || 0;
  const pendingCount = maintenanceStats.byStatus.pending || 0;
  const rejectedCount = maintenanceStats.byStatus.rejected || 0;

  const maintenanceBranch = {
    id: 'maintenance',
    label: 'Maintenance Agent',
    description: 'Task extraction & scheduling',
    stages: [
      {
        id: 'maint_systems_searched',
        label: 'Systems Searched',
        description: 'Systems with Pinecone search results',
        count: maintenanceStats.systemsSearched,
        percentage: vectorizedSystems.uniqueSystems > 0
          ? Math.round((maintenanceStats.systemsSearched / vectorizedSystems.uniqueSystems) * 100)
          : 0,
        icon: '🔎'
      },
      {
        id: 'maint_systems_with_tasks',
        label: 'Systems with Tasks',
        description: 'Systems where tasks were extracted',
        count: maintenanceStats.systemsWithTasks,
        percentage: maintenanceStats.systemsSearched > 0
          ? Math.round((maintenanceStats.systemsWithTasks / maintenanceStats.systemsSearched) * 100)
          : 0,
        icon: '📋'
      },
      {
        id: 'maint_tasks_extracted',
        label: 'Tasks Extracted',
        description: 'Total tasks from all systems',
        count: maintenanceStats.totalTasks,
        breakdown: maintenanceStats.byStatus,
        icon: '📝'
      },
      {
        id: 'maint_tasks_approved',
        label: 'Tasks Approved',
        description: 'Ready for todo list',
        count: approvedCount,
        breakdown: {
          'By Category': maintenanceStats.byCategory,
          'By Frequency': maintenanceStats.byFrequencyBasis
        },
        maintenanceDetails: {
          bySystem: maintenanceStats.approvedBySystem,
          byCategory: maintenanceStats.byCategory,
          byFrequencyBasis: maintenanceStats.byFrequencyBasis
        },
        icon: '✅'
      },
      {
        id: 'live_tasks',
        label: 'Live Tasks',
        description: 'Active in todo system',
        count: liveTaskStats.boatosTasks.total + liveTaskStats.userTasks.total,
        breakdown: {
          'BoatOS Tasks': liveTaskStats.boatosTasks.total,
          'User Tasks': liveTaskStats.userTasks.total,
          'Completions': liveTaskStats.completions
        },
        liveTaskDetails: {
          boatosTasks: liveTaskStats.boatosTasks,
          userTasks: liveTaskStats.userTasks,
          completions: liveTaskStats.completions
        },
        icon: '📱'
      }
    ]
  };

  const funnel = {
    // Keep stages for backwards compatibility (flat list)
    stages: [
      ...sharedStages,
      ...dipBranch.stages,
      ...maintenanceBranch.stages
    ],
    // New branching structure
    shared: sharedStages,
    branches: {
      dip: dipBranch,
      maintenance: maintenanceBranch
    },
    issues: dataIssues,
    generated_at: new Date().toISOString(),
    processing_time_ms: Date.now() - startTime
  };

  requestLogger.info('Funnel stats generated', {
    processing_time_ms: funnel.processing_time_ms,
    sharedStages: sharedStages.length,
    dipStages: dipBranch.stages.length,
    maintenanceStages: maintenanceBranch.stages.length
  });

  return funnel;
}
