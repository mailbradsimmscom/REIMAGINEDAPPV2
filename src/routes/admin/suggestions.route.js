/**
 * Admin suggestions routes - DIP + Suggestions → Admin Review & Apply workflow
 * Provides endpoints for fetching, viewing, and applying document suggestions
 */

import { Router, json as bodyParser } from 'express';
import { getSupabaseStorageClient } from '../../repositories/supabaseClient.js';
import { validateDIP, validateSuggestions } from '../../schemas/ingestion.schema.js';
import { applySuggestions } from '../../services/suggestions.apply.service.js';
import { extractTextPreviewFromPdf } from '../../ingestion/helpers/pdfPreview.js';
import { logger } from '../../utils/logger.js';

const router = Router();

// Supabase Storage bucket for documents
const BUCKET = 'documents';

/**
 * GET /admin/suggestions/:docId
 * Fetch DIP and Suggestions for a document
 */
router.get('/:docId', async (req, res) => {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const { docId } = req.params;
    
    if (!docId || typeof docId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid document ID is required',
        requestId: requestLogger.requestId
      });
    }
    
    requestLogger.info('Fetching suggestions', { docId });
    
    // Get Supabase Storage client
    const storage = getSupabaseStorageClient();
    if (!storage) {
      return res.status(500).json({
        success: false,
        error: 'Storage service unavailable',
        requestId: requestLogger.requestId
      });
    }
    
    // Read DIP and Suggestions from storage
    const [dipResult, suggestionsResult] = await Promise.allSettled([
      readJsonFromStorage(storage, `doc_intelligence_packet_${docId}.json`),
      readJsonFromStorage(storage, `ingestion_suggestions_${docId}.json`)
    ]);
    
    // Handle DIP result
    let dip = null;
    if (dipResult.status === 'fulfilled') {
      const dipValidation = validateDIP(dipResult.value);
      if (dipValidation.success) {
        dip = dipValidation.data;
      } else {
        requestLogger.warn('Invalid DIP format', { 
          docId, 
          error: dipValidation.error.message 
        });
      }
    } else {
      requestLogger.warn('Failed to read DIP', { 
        docId, 
        error: dipResult.reason.message 
      });
    }
    
    // Handle Suggestions result
    let suggestions = null;
    if (suggestionsResult.status === 'fulfilled') {
      const suggestionsValidation = validateSuggestions(suggestionsResult.value);
      if (suggestionsValidation.success) {
        suggestions = suggestionsValidation.data;
      } else {
        requestLogger.warn('Invalid Suggestions format', { 
          docId, 
          error: suggestionsValidation.error.message 
        });
      }
    } else {
      requestLogger.warn('Failed to read Suggestions', { 
        docId, 
        error: suggestionsResult.reason.message 
      });
    }
    
    // Check text health - test text extraction capability
    let textHealth = { status: 'unknown', source: 'none', pages: 0 };
    try {
      const textResult = await extractTextPreviewFromPdf(docId, 3); // Test first 3 pages
      if (textResult && textResult.length > 0) {
        textHealth = {
          status: 'healthy',
          source: 'database', // or 'storage' based on what worked
          pages: textResult.length,
          totalChars: textResult.reduce((sum, page) => sum + (page.text?.length || 0), 0)
        };
      } else {
        textHealth = { status: 'unhealthy', source: 'none', pages: 0 };
      }
    } catch (error) {
      textHealth = { 
        status: 'error', 
        source: 'none', 
        pages: 0, 
        error: error.message 
      };
      requestLogger.warn('Text health check failed', { docId, error: error.message });
    }

    requestLogger.info('Suggestions fetched successfully', { 
      docId, 
      hasDIP: !!dip, 
      hasSuggestions: !!suggestions,
      textHealth: textHealth.status
    });
    
    // Always return text health, even if DIP/Suggestions are missing
    res.json({
      success: true,
      data: {
        doc_id: docId,
        dip,
        suggestions,
        text_health: textHealth,
        fetched_at: new Date().toISOString()
      },
      requestId: requestLogger.requestId
    });
    
  } catch (error) {
    requestLogger.error('Failed to fetch suggestions', { 
      docId: req.params.docId, 
      error: error.message 
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      requestId: requestLogger.requestId
    });
  }
});

/**
 * GET /admin/suggestions/:docId/view
 * Server-rendered HTML page for reviewing suggestions
 */
router.get('/:docId/view', async (req, res) => {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const { docId } = req.params;
    
    if (!docId || typeof docId !== 'string') {
      return res.status(400).send(renderErrorHtml('Invalid document ID'));
    }
    
    requestLogger.info('Rendering suggestions view', { docId });
    
    // Fetch suggestions data
    const response = await fetch(`http://localhost:${process.env.PORT || 3000}/admin/suggestions/${docId}`, {
      headers: {
        'x-admin-token': req.headers['x-admin-token'] || ''
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).send(renderErrorHtml(
        errorData.error || 'Failed to fetch suggestions'
      ));
    }
    
    const data = await response.json();
    if (!data.success) {
      return res.status(400).send(renderErrorHtml(data.error || 'Invalid response'));
    }
    
    // Render HTML page
    const html = renderSuggestionsHtml(docId, data.data);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
    
  } catch (error) {
    requestLogger.error('Failed to render suggestions view', { 
      docId: req.params.docId, 
      error: error.message 
    });
    
    res.status(500).send(renderErrorHtml('Internal server error'));
  }
});

/**
 * POST /admin/suggestions/:docId/apply
 * Apply accepted suggestions to configuration files
 */
router.post('/:docId/apply', bodyParser({ limit: '1mb' }), async (req, res) => {
  const requestLogger = logger.createRequestLogger();
  
  try {
    const { docId } = req.params;
    const { accepted, options = {} } = req.body;
    
    if (!docId || typeof docId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Valid document ID is required',
        requestId: requestLogger.requestId
      });
    }
    
    if (!accepted || typeof accepted !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Accepted suggestions object is required',
        requestId: requestLogger.requestId
      });
    }
    
    requestLogger.info('Applying suggestions', { 
      docId, 
      dryRun: options.dry_run || false 
    });
    
    // Apply suggestions
    const result = await applySuggestions({
      docId,
      accepted,
      options: {
        create_snapshot: options.create_snapshot !== false,
        dry_run: options.dry_run || false,
        notify_on_completion: options.notify_on_completion || false
      }
    });
    
    requestLogger.info('Suggestions applied successfully', { 
      docId, 
      totalChanges: Object.values(result.applied_changes).reduce((sum, count) => sum + count, 0),
      snapshotId: result.snapshot_id
    });
    
    res.json({
      success: true,
      data: result,
      requestId: requestLogger.requestId
    });
    
  } catch (error) {
    requestLogger.error('Failed to apply suggestions', { 
      docId: req.params.docId, 
      error: error.message 
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to apply suggestions',
      details: error.message,
      requestId: requestLogger.requestId
    });
  }
});

/**
 * Helper function to read JSON from Supabase Storage
 * @param {Object} storage - Supabase Storage client
 * @param {string} path - File path in storage
 * @returns {Promise<Object>} Parsed JSON data
 */
async function readJsonFromStorage(storage, path) {
  const { data, error } = await storage
    .from(BUCKET)
    .download(path);
  
  if (error) {
    throw new Error(`Storage error: ${error.message}`);
  }
  
  if (!data) {
    throw new Error('No data returned from storage');
  }
  
  const text = await data.text();
  return JSON.parse(text);
}


/**
 * Render HTML page for suggestions review
 * @param {string} docId - Document ID
 * @param {Object} data - Suggestions data
 * @returns {string} HTML content
 */
function renderSuggestionsHtml(docId, data) {
  const { dip, suggestions } = data;
  const esc = s => String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;');
  
  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>Suggestions · ${esc(docId)}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:20px;background:#f5f5f5}
.container{max-width:1200px;margin:0 auto;background:white;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1)}
.header{background:#2563eb;color:white;padding:20px;border-radius:8px 8px 0 0}
.header h1{margin:0;font-size:24px}
.header p{margin:5px 0 0 0;opacity:0.9}
.content{padding:20px}
.section{margin-bottom:30px;padding:20px;border:1px solid #e5e7eb;border-radius:6px}
.section h2{margin:0 0 15px 0;color:#374151;font-size:18px}
.checkbox-group{display:grid;gap:10px}
.checkbox-item{display:flex;align-items:center;padding:10px;background:#f9fafb;border-radius:4px}
.checkbox-item input[type="checkbox"]{margin-right:10px}
.checkbox-item label{flex:1;cursor:pointer}
.item-details{font-size:14px;color:#6b7280;margin-top:5px}
.actions{margin-top:30px;padding:20px;background:#f9fafb;border-radius:6px}
.btn{padding:12px 24px;border:none;border-radius:6px;font-size:16px;cursor:pointer;margin-right:10px}
.btn-primary{background:#2563eb;color:white}
.btn-secondary{background:#6b7280;color:white}
.btn:hover{opacity:0.9}
.status{padding:10px;border-radius:4px;margin:10px 0}
.status.success{background:#d1fae5;color:#065f46;border:1px solid #a7f3d0}
.status.error{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}
.loading{display:none;text-align:center;padding:20px}
.spinner{border:3px solid #f3f3f3;border-top:3px solid #2563eb;border-radius:50%;width:30px;height:30px;animation:spin 1s linear infinite;margin:0 auto}
@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>📋 Suggestions Review</h1>
<p>Document ID: ${esc(docId)}</p>
</div>
<div class="content">
<div id="status"></div>
${renderSuggestionsSection(suggestions)}
<div class="actions">
<button class="btn btn-primary" onclick="applySuggestions()">Apply Selected</button>
<button class="btn btn-secondary" onclick="selectAll()">Select All</button>
<button class="btn btn-secondary" onclick="selectNone()">Select None</button>
</div>
<div class="loading" id="loading">
<div class="spinner"></div>
<p>Applying suggestions...</p>
</div>
</div>
</div>
<script>
const docId = '${esc(docId)}';
function showStatus(message, type = 'success') {
const status = document.getElementById('status');
status.innerHTML = '<div class="status ' + type + '">' + message + '</div>';
setTimeout(() => status.innerHTML = '', 5000);
}
function selectAll() {
document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
}
function selectNone() {
document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
}
async function applySuggestions() {
const loading = document.getElementById('loading');
loading.style.display = 'block';
try {
const accepted = {};
document.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
const section = cb.closest('.section').dataset.section;
const item = JSON.parse(cb.dataset.item);
if (!accepted[section]) accepted[section] = {};
if (section === 'entities') {
if (!accepted.entities.add_aliases) accepted.entities.add_aliases = {};
if (!accepted.entities.add_aliases[item.key]) accepted.entities.add_aliases[item.key] = [];
accepted.entities.add_aliases[item.key].push(item.value);
} else if (section === 'intents') {
if (!accepted.intents.hints) accepted.intents.hints = [];
accepted.intents.hints.push(item);
} else if (section === 'playbooks') {
if (!accepted.playbooks) accepted.playbooks = {};
if (!accepted.playbooks[item.key]) accepted.playbooks[item.key] = { boost_add: [], filters_add: [] };
if (item.type === 'boost') accepted.playbooks[item.key].boost_add.push(item.value);
if (item.type === 'filter') accepted.playbooks[item.key].filters_add.push(item.value);
} else if (section === 'units') {
if (!accepted.units.suggest_add) accepted.units.suggest_add = [];
accepted.units.suggest_add.push(item);
} else if (section === 'tests') {
if (!accepted.tests.seed_goldens) accepted.tests.seed_goldens = [];
accepted.tests.seed_goldens.push(item);
}
});
const response = await fetch('/admin/suggestions/' + docId + '/apply', {
method: 'POST',
headers: { 'Content-Type': 'application/json', 'x-admin-token': '${req.headers['x-admin-token'] || ''}' },
body: JSON.stringify({ accepted, options: { create_snapshot: true, dry_run: false } })
});
const result = await response.json();
if (result.success) {
const changes = result.data.applied_changes;
const totalChanges = Object.values(changes).reduce((sum, count) => sum + count, 0);
showStatus('✅ Successfully applied ' + totalChanges + ' changes! Snapshot: ' + result.data.snapshot_id, 'success');
} else {
showStatus('❌ Error: ' + result.error, 'error');
}
} catch (error) {
showStatus('❌ Error: ' + error.message, 'error');
} finally {
loading.style.display = 'none';
}
}
</script>
</body></html>`;
}

/**
 * Render suggestions section HTML
 * @param {Object} suggestions - Suggestions data
 * @returns {string} HTML content
 */
function renderSuggestionsSection(suggestions) {
  if (!suggestions) {
    return '<div class="section"><h2>No Suggestions Available</h2><p>No suggestions found for this document.</p></div>';
  }
  
  let html = '';
  
  // Entities section
  if (suggestions.entities?.add_aliases && Object.keys(suggestions.entities.add_aliases).length > 0) {
    html += '<div class="section" data-section="entities"><h2>🏷️ Entity Aliases</h2><div class="checkbox-group">';
    
    for (const [entity, aliases] of Object.entries(suggestions.entities.add_aliases)) {
      for (const alias of aliases) {
        html += '<div class="checkbox-item">';
        html += '<input type="checkbox" id="entity-' + entity + '-' + alias + '" data-item=\'{"key":"' + entity + '","value":"' + alias + '"}\'>';
        html += '<label for="entity-' + entity + '-' + alias + '">';
        html += '<strong>' + entity + '</strong> → ' + alias;
        html += '<div class="item-details">Add alias for entity recognition</div>';
        html += '</label></div>';
      }
    }
    
    html += '</div></div>';
  }
  
  // Intent hints section
  if (suggestions.intents?.hints?.length > 0) {
    html += '<div class="section" data-section="intents"><h2>🎯 Intent Hints</h2><div class="checkbox-group">';
    
    for (const hint of suggestions.intents.hints) {
      html += '<div class="checkbox-item">';
      html += '<input type="checkbox" id="intent-' + hint.intent + '" data-item=\'' + JSON.stringify(hint) + '\'>';
      html += '<label for="intent-' + hint.intent + '">';
      html += '<strong>' + hint.intent + '</strong> (weight: ' + hint.raise_to + ')';
      html += '<div class="item-details">' + (hint.reason || 'Improve intent detection') + '</div>';
      html += '</label></div>';
    }
    
    html += '</div></div>';
  }
  
  // Playbooks section
  if (suggestions.playbooks && Object.keys(suggestions.playbooks).length > 0) {
    html += '<div class="section" data-section="playbooks"><h2>📚 Maintenance Playbooks</h2><div class="checkbox-group">';
    
    for (const [playbook, data] of Object.entries(suggestions.playbooks)) {
      if (data.boost_add?.length > 0) {
        for (const token of data.boost_add) {
          html += '<div class="checkbox-item">';
          html += '<input type="checkbox" id="playbook-' + playbook + '-boost-' + token + '" data-item=\'{"key":"' + playbook + '","type":"boost","value":"' + token + '"}\'>';
          html += '<label for="playbook-' + playbook + '-boost-' + token + '">';
          html += '<strong>' + playbook + '</strong> boost: ' + token;
          html += '<div class="item-details">Add maintenance token</div>';
          html += '</label></div>';
        }
      }
      
      if (data.filters_add?.length > 0) {
        for (const regex of data.filters_add) {
          html += '<div class="checkbox-item">';
          html += '<input type="checkbox" id="playbook-' + playbook + '-filter-' + regex + '" data-item=\'{"key":"' + playbook + '","type":"filter","value":"' + regex + '"}\'>';
          html += '<label for="playbook-' + playbook + '-filter-' + regex + '">';
          html += '<strong>' + playbook + '</strong> filter: ' + regex;
          html += '<div class="item-details">Add maintenance regex</div>';
          html += '</label></div>';
        }
      }
    }
    
    html += '</div></div>';
  }
  
  // Units section
  if (suggestions.units?.suggest_add?.length > 0) {
    html += '<div class="section" data-section="units"><h2>📏 Unit Suggestions</h2><div class="checkbox-group">';
    
    for (const unit of suggestions.units.suggest_add) {
      html += '<div class="checkbox-item">';
      html += '<input type="checkbox" id="unit-' + unit.alias + '" data-item=\'' + JSON.stringify(unit) + '\'>';
      html += '<label for="unit-' + unit.alias + '">';
      html += '<strong>' + unit.alias + '</strong> → ' + unit.suggestedGroup;
      html += '<div class="item-details">' + (unit.evidence || 'Add unit alias') + ' (count: ' + unit.count + ')</div>';
      html += '</label></div>';
    }
    
    html += '</div></div>';
  }
  
  // Tests section
  if (suggestions.tests?.seed_goldens?.length > 0) {
    html += '<div class="section" data-section="tests"><h2>🧪 Golden Tests</h2><div class="checkbox-group">';
    
    for (const test of suggestions.tests.seed_goldens) {
      html += '<div class="checkbox-item">';
      html += '<input type="checkbox" id="test-' + test + '" data-item=\'' + JSON.stringify(test) + '\'>';
      html += '<label for="test-' + test + '">';
      html += '<strong>Test:</strong> ' + test;
      html += '<div class="item-details">Generate golden test case</div>';
      html += '</label></div>';
    }
    
    html += '</div></div>';
  }
  
  return html || '<div class="section"><h2>No Suggestions Available</h2><p>No suggestions found for this document.</p></div>';
}

/**
 * Render error HTML page
 * @param {string} error - Error message
 * @returns {string} HTML content
 */
function renderErrorHtml(error) {
  const esc = s => String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;');
  
  return '<!doctype html>' +
    '<html>' +
    '<head>' +
    '  <meta charset="utf-8">' +
    '  <title>Error</title>' +
    '  <style>' +
    '    body { font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }' +
    '    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); padding: 40px; text-align: center; }' +
    '    .error { color: #dc2626; font-size: 18px; margin-bottom: 20px; }' +
    '    .back { color: #2563eb; text-decoration: none; }' +
    '  </style>' +
    '</head>' +
    '<body>' +
    '  <div class="container">' +
    '    <div class="error">❌ ' + esc(error) + '</div>' +
    '    <a href="/admin" class="back">← Back to Admin</a>' +
    '  </div>' +
    '</body>' +
    '</html>';
}

export default router;
