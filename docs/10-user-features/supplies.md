# Supplies & Tools

## Overview

Supplies management allows users to track boat supplies, tools, and consumables. Features AI-powered photo analysis using GPT-4V to automatically identify items, and system linking to associate supplies with equipment.

**Who uses it:** Boat owners, crew
**Access:** Mobile (`/supplies.html`), Admin (`/supplies-admin.html`)

---

## User Flow

### Adding a Supply (Multi-Photo Capture)

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Screen 1: Photo Capture                                     │
│     ├── Take photo with camera                                  │
│     ├── Can capture multiple photos                             │
│     └── Photos stored in pendingBase64Photos array              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. AI Photo Analysis (GPT-4V)                                  │
│     ├── POST /api/supplies/analyze-photo                        │
│     ├── Extracts: item_name, brand, part_number                 │
│     ├── Suggests: category, unit                                │
│     └── Returns confidence score                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Screen 2: Details Form                                      │
│     ├── Form prefilled from AI extraction                       │
│     ├── User confirms/edits values                              │
│     └── Adds quantity, location, notes                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Screen 3: System Linking                                    │
│     ├── AI suggests related boat systems                        │
│     ├── User confirms/selects systems                           │
│     └── Creates supply-system links                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. Save Supply                                                 │
│     ├── POST /api/supplies (create supply record)               │
│     ├── Upload photos to Supabase Storage                       │
│     └── Create supply_system_links                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Concepts

| Term | Definition |
|------|------------|
| **Supply** | Any tracked inventory item |
| **Category** | Grouping (Engine Parts, Electrical, Safety, etc.) |
| **Unit** | How item is measured (each, box, gallon, feet) |
| **Linked System** | Equipment this supply is used for |
| **Photo Analysis** | GPT-4V extracting details from photos |
| **pendingBase64Photos** | Array of captured photos awaiting upload |

---

## AI Photo Analysis Service

**File:** `src/services/supplies/ai-analysis.service.js`

### Single Photo Analysis

```javascript
// src/services/supplies/ai-analysis.service.js:24-146
export async function analyzeSupplyPhoto(photoUrl, options = {}) {
  // Build file path and read image as base64
  const filePath = photoUrl.startsWith('/')
    ? path.join(process.cwd(), photoUrl)
    : path.join(process.cwd(), '/', photoUrl);

  const imageBuffer = fs.readFileSync(filePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = photoUrl.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  const imageDataUrl = `data:${mimeType};base64,${base64Image}`;

  // Use provided categories/units or defaults
  const categories = options.categories?.length > 0
    ? options.categories.join(', ')
    : 'Engine Parts & Service, Electrical, Plumbing & Water Systems, ...';

  const systemPrompt = `You are an expert at analyzing marine equipment and supply items from photos.
Your task is to extract key information from the image and return it in a structured format.

Focus on identifying:
- Item name (what is this item?)
- Brand/manufacturer (if visible)
- Part number or model number (if visible)
- Suggested category (where would this item belong in a boat inventory?)
- Suggested unit of measure (how would this item typically be counted/measured?)

Be specific and accurate. If you cannot determine something with confidence, use null.`;

  const userPrompt = `Analyze this supply item photo and extract:

1. Item name (e.g., "Oil Filter", "Bilge Pump", "Shackle")
2. Brand (e.g., "Racor", "Rule", "Harken")
3. Part number (e.g., "2010PM", "500GPH", "H2161")
4. Suggested category - choose the BEST match from: ${categories}
5. Suggested unit - choose the BEST match from: ${units}

Return your analysis in this exact JSON format:
{
  "item_name": "extracted name or null",
  "brand": "extracted brand or null",
  "part_number": "extracted part number or null",
  "suggested_category": "best matching category from the list",
  "suggested_unit": "best matching unit from the list",
  "confidence": 0.0-1.0,
  "notes": "brief explanation of what you see"
}`;

  const response = await oaiVision({
    system: systemPrompt,
    user: userPrompt,
    imageUrl: imageDataUrl,
    maxOutputTokens: 500
  });

  // Parse JSON from response (GPT-4V sometimes adds markdown)
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  const analysisResult = JSON.parse(jsonMatch[0]);

  return {
    success: true,
    data: {
      item_name: analysisResult.item_name,
      brand: analysisResult.brand,
      part_number: analysisResult.part_number,
      suggested_category: analysisResult.suggested_category,
      suggested_unit: analysisResult.suggested_unit || null,
      confidence: analysisResult.confidence || 0,
      notes: analysisResult.notes || ''
    }
  };
}
```

### Multi-Photo Analysis (Cross-Reference)

```javascript
// src/services/supplies/ai-analysis.service.js:271-398
export async function analyzeMultipleSupplyPhotos(imageBase64Array, options = {}) {
  // Validate input
  if (!imageBase64Array || !Array.isArray(imageBase64Array) || imageBase64Array.length === 0) {
    throw new Error('imageBase64Array must be a non-empty array');
  }

  requestLogger.info('Analyzing multiple supply photos', {
    photoCount: imageBase64Array.length
  });

  const systemPrompt = `You are an expert at analyzing marine equipment and supply items from photos.
You are receiving MULTIPLE photos of the SAME supply item from different angles.

Your task is to:
1. Cross-reference information between all photos
2. One photo might show a label with part number, another the full item, another the packaging
3. Combine all visible information into ONE accurate result
4. If photos appear to show DIFFERENT items, set confidence to 0 and note the discrepancy

Be specific and accurate. If you cannot determine something with confidence, use null.`;

  const userPrompt = `Analyze these ${imageBase64Array.length} photos of the SAME supply item and extract:

1. Item name (e.g., "Oil Filter", "Bilge Pump", "Shackle")
2. Brand (e.g., "Racor", "Rule", "Harken")
3. Part number (e.g., "2010PM", "500GPH", "H2161")
4. Suggested category - choose the BEST match from: ${categories}
5. Suggested unit - choose the BEST match from: ${units}
6. Quantity visible - count items in photos, or read "Pack of X" from packaging
7. Additional insights - material, size, specs, thread type, voltage, condition, expiration

Cross-reference ALL photos to get the most accurate information.

Return JSON:
{
  "item_name": "extracted name or null",
  "brand": "extracted brand or null",
  "part_number": "extracted part number or null",
  "suggested_category": "best matching category",
  "suggested_unit": "best matching unit",
  "quantity_visible": number or null,
  "additional_insights": "material, specs, condition, etc.",
  "confidence": 0.0-1.0,
  "notes": "which photo(s) each piece of info came from",
  "photos_analyzed": ${imageBase64Array.length}
}`;

  const response = await oaiVisionMulti({
    system: systemPrompt,
    user: userPrompt,
    imageUrls: imageBase64Array,
    maxOutputTokens: 800
  });

  const jsonMatch = response.match(/\{[\s\S]*\}/);
  const analysisResult = JSON.parse(jsonMatch[0]);

  return {
    success: true,
    data: {
      item_name: analysisResult.item_name,
      brand: analysisResult.brand,
      part_number: analysisResult.part_number,
      suggested_category: analysisResult.suggested_category,
      suggested_unit: analysisResult.suggested_unit || null,
      quantity_visible: analysisResult.quantity_visible || null,
      additional_insights: analysisResult.additional_insights || null,
      confidence: analysisResult.confidence || 0,
      notes: analysisResult.notes || '',
      photos_analyzed: imageBase64Array.length
    }
  };
}
```

### System Recommendations (Pinecone + GPT)

```javascript
// src/services/supplies/ai-analysis.service.js:406-550
export async function suggestSystemsForSupply(itemData) {
  const { item_name, brand, part_number, category } = itemData;

  // Build semantic search query
  const queryParts = [item_name, brand, part_number].filter(Boolean);
  const searchQuery = queryParts.join(' ');

  // Search Pinecone for relevant document chunks
  const pineconeResults = await pineconeRepository.searchVectors(searchQuery, {
    topK: 20,
    includeMetadata: true,
    includeValues: false
  });

  if (!pineconeResults.matches || pineconeResults.matches.length === 0) {
    return {
      success: true,
      data: {
        suggestions: [],
        query: searchQuery,
        message: 'No relevant systems found in documentation'
      }
    };
  }

  // Group results by asset_uid and calculate relevance
  const systemScores = {};

  for (const match of pineconeResults.matches) {
    const metadata = match.metadata || {};
    const assetUid = metadata.linked_asset_uid;

    if (!assetUid) continue;

    if (!systemScores[assetUid]) {
      systemScores[assetUid] = {
        asset_uid: assetUid,
        scores: [],
        chunks: [],
        manufacturer: metadata.manufacturer || 'Unknown',
        model: metadata.model || 'Unknown'
      };
    }

    systemScores[assetUid].scores.push(match.score);
    systemScores[assetUid].chunks.push({
      content: metadata.content || metadata.text || '',
      score: match.score,
      page: metadata.page || 0
    });
  }

  // Calculate average score and sort - top 5 systems
  const rankedSystems = Object.values(systemScores)
    .map(sys => ({
      ...sys,
      avgScore: sys.scores.reduce((a, b) => a + b, 0) / sys.scores.length,
      maxScore: Math.max(...sys.scores),
      chunkCount: sys.chunks.length
    }))
    .sort((a, b) => b.maxScore - a.maxScore)
    .slice(0, 5);

  // Lookup full system metadata
  const suggestions = [];

  for (const rankedSystem of rankedSystems) {
    const systemData = await getSystemByAssetUid(rankedSystem.asset_uid);
    if (!systemData) continue;

    const bestChunk = rankedSystem.chunks.sort((a, b) => b.score - a.score)[0];

    suggestions.push({
      asset_uid: systemData.asset_uid,
      manufacturer: systemData.manufacturer_norm,
      model: systemData.model_norm,
      system: systemData.system_norm,
      subsystem: systemData.subsystem_norm,
      description: systemData.description || '',
      confidence: Math.round(rankedSystem.maxScore * 100) / 100,
      reason: bestChunk.content.substring(0, 200) + '...',
      chunkCount: rankedSystem.chunkCount
    });
  }

  return {
    success: true,
    data: {
      suggestions,
      query: searchQuery,
      totalMatches: pineconeResults.matches.length
    }
  };
}
```

---

## Supplies Service

**File:** `src/services/supplies/supplies.service.js`

### Create Supply with Validation

```javascript
// src/services/supplies/supplies.service.js:62-130
export async function createSupply(supplyData) {
  // Validate required fields
  if (!supplyData.item_name) {
    const error = new Error('item_name is required');
    error.status = 400;
    throw error;
  }

  if (!supplyData.category_id) {
    const error = new Error('category_id is required');
    error.status = 400;
    throw error;
  }

  // Validate numeric fields
  if (supplyData.current_stock !== undefined && supplyData.current_stock < 0) {
    const error = new Error('current_stock cannot be negative');
    error.status = 400;
    throw error;
  }

  // Sanitize data
  const sanitizedData = {
    item_name: supplyData.item_name.trim(),
    category_id: supplyData.category_id,
    current_stock: supplyData.current_stock ?? 0,
    unit_id: supplyData.unit_id || null,
    location: supplyData.location?.trim() || null,
    location_details: supplyData.location_details?.trim() || null,
    system_asset_uid: supplyData.system_asset_uid || null,
    reorder_threshold: supplyData.reorder_threshold || null,
    reorder_quantity: supplyData.reorder_quantity || null,
    auto_reorder_enabled: supplyData.auto_reorder_enabled ?? false,
    brand: supplyData.brand?.trim() || null,
    supplier: supplyData.supplier?.trim() || null,
    part_number: supplyData.part_number?.trim() || null,
    barcode: supplyData.barcode?.trim() || null,
    purchase_url: supplyData.purchase_url?.trim() || null,
    typical_price: supplyData.typical_price || null,
    currency: supplyData.currency || 'USD',
    colloquial_names: supplyData.colloquial_names || [],
    keywords: supplyData.keywords || [],
    photos: supplyData.photos || [],
    notes: supplyData.notes?.trim() || null,
    is_critical: supplyData.is_critical ?? false,
    is_hazmat: supplyData.is_hazmat ?? false,
    best_before: supplyData.best_before || null,
    date_opened: supplyData.date_opened || null,
    shelf_life_days: supplyData.shelf_life_days || null
  };

  const supply = await suppliesRepository.createSupply(sanitizedData);

  return { success: true, data: supply };
}
```

### Low Stock Detection

```javascript
// src/services/supplies/supplies.service.js:235-248
export async function getLowStockSupplies(autoReorderOnly = false) {
  const supplies = await suppliesRepository.getLowStockSupplies(autoReorderOnly);

  return {
    success: true,
    data: supplies,
    count: supplies.length
  };
}
```

---

## Supplies Repository

**File:** `src/repositories/supplies/supplies.repository.js`

### Full-Text Search

```javascript
// src/repositories/supplies/supplies.repository.js:247-283
export async function searchSupplies(query, { limit = 20, offset = 0 } = {}) {
  const supabase = await checkSupabaseAvailability();

  // Use textSearch on search_vector column (updated by trigger)
  const { data, error, count } = await supabase
    .from(TABLE)
    .select(`
      *,
      supply_categories(category_name),
      supply_units(unit_name, abbreviation)
    `, { count: 'exact' })
    .textSearch('search_vector', query, {
      type: 'websearch',
      config: 'english'
    })
    .range(offset, offset + limit - 1);

  if (error) {
    const err = new Error(`Search failed: ${error.message}`);
    err.cause = error;
    throw err;
  }

  return {
    data: data ?? [],
    count: count ?? 0,
    query,
    limit,
    offset
  };
}
```

### Low Stock Query

```javascript
// src/repositories/supplies/supplies.repository.js:289-327
export async function getLowStockSupplies(autoReorderOnly = false) {
  const supabase = await checkSupabaseAvailability();

  let query = supabase
    .from(TABLE)
    .select(`
      *,
      supply_categories(category_name),
      supply_units(unit_name, abbreviation)
    `)
    .not('reorder_threshold', 'is', null)
    .order('current_stock', { ascending: true });

  if (autoReorderOnly) {
    query = query.eq('auto_reorder_enabled', true);
  }

  const { data, error } = await query;

  // Filter in memory for column comparison (current_stock <= reorder_threshold)
  const lowStockItems = (data ?? []).filter(item =>
    item.current_stock <= item.reorder_threshold
  );

  return lowStockItems;
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  supplies-wizard.js (Frontend)                                  │
│  ├── Photo capture (camera API)                                 │
│  ├── pendingBase64Photos[] - stores captured photos             │
│  └── Multi-screen wizard UI                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                    fetch() with base64
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  /api/supplies/analyze-photo (supplies.route.js)                │
│  └── ai-analysis.service.js                                     │
│      ├── analyzeSupplyPhoto() - single photo                    │
│      ├── analyzeMultipleSupplyPhotos() - cross-reference        │
│      └── suggestSystemsForSupply() - Pinecone + systems lookup  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  /api/supplies (POST) - Create supply                           │
│  ├── supplies.service.js - validation + sanitization            │
│  ├── supplies.repository.js - Supabase operations               │
│  └── photo-storage.service.js → Supabase Storage                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase                                                       │
│  ├── supplies table                                             │
│  ├── supply_categories table                                    │
│  ├── supply_units table                                         │
│  ├── supply_system_links table                                  │
│  └── Storage bucket (photos)                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Files & Locations

| Purpose | Path |
|---------|------|
| **Frontend** | |
| Supplies page | `src/public/supplies.html` |
| Admin page | `src/public/supplies-admin.html` |
| Wizard JS | `src/public/js/supplies/supplies-wizard.js` |
| Photos JS | `src/public/js/supplies/supplies-photos.js` |
| AI JS | `src/public/js/supplies/supplies-ai.js` |
| API JS | `src/public/js/supplies/supplies-api.js` |
| Form JS | `src/public/js/supplies/supplies-form.js` |
| List JS | `src/public/js/supplies/supplies-list.js` |
| **Routes** | |
| Index | `src/routes/supplies/index.js` |
| Supplies route | `src/routes/supplies/supplies.route.js` |
| Config route | `src/routes/supplies/config.route.js` |
| **Services** | |
| AI analysis | `src/services/supplies/ai-analysis.service.js` |
| Supplies service | `src/services/supplies/supplies.service.js` |
| Photo storage | `src/services/supplies/photo-storage.service.js` |
| **Repository** | |
| Supplies repo | `src/repositories/supplies/supplies.repository.js` |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/supplies` | List all supplies |
| POST | `/api/supplies` | Create supply |
| GET | `/api/supplies/:id` | Get supply details |
| PUT | `/api/supplies/:id` | Update supply |
| DELETE | `/api/supplies/:id` | Delete supply |
| GET | `/api/supplies/search?q=` | Full-text search |
| GET | `/api/supplies/low-stock` | Items below reorder threshold |
| GET | `/api/supplies/category/:categoryId` | Supplies by category |
| GET | `/api/supplies/system/:assetUid` | Supplies by system |
| POST | `/api/supplies/analyze-photo` | AI single photo analysis |
| POST | `/api/supplies/analyze-photos` | AI multi-photo analysis |
| POST | `/api/supplies/suggest-systems` | AI system recommendations |
| POST | `/api/supplies/:id/photo` | Upload photo |
| GET | `/api/supplies/categories` | List categories |
| GET | `/api/supplies/units` | List units |
| GET | `/api/supplies/config` | Get config (categories + units) |

---

## Database Tables

### supplies

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| item_name | text | Item name (required) |
| brand | text | Manufacturer |
| part_number | text | Part/model number |
| barcode | text | Barcode/UPC |
| category_id | uuid | FK to supply_categories |
| unit_id | uuid | FK to supply_units |
| current_stock | numeric | Current quantity |
| reorder_threshold | numeric | Low stock alert level |
| reorder_quantity | numeric | How many to reorder |
| auto_reorder_enabled | boolean | Enable auto-reorder alerts |
| location | text | Where stored on boat |
| location_details | text | Specific storage details |
| system_asset_uid | text | Linked equipment |
| supplier | text | Where to buy |
| purchase_url | text | Link to buy |
| typical_price | numeric | Expected price |
| currency | text | Currency (default USD) |
| colloquial_names | text[] | Alternative names |
| keywords | text[] | Search keywords |
| photos | text[] | Photo URLs |
| notes | text | Additional notes |
| is_critical | boolean | Critical item flag |
| is_hazmat | boolean | Hazardous material flag |
| best_before | date | Expiration date |
| date_opened | date | When opened |
| shelf_life_days | integer | Days until expiration |
| item_type | text | supply/tool/item |
| search_vector | tsvector | Full-text search index |
| created_at | timestamp | Creation time |
| updated_at | timestamp | Last update |

### supply_categories

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| category_name | text | Category name |
| description | text | Category description |
| sort_order | integer | Display order |

**Default Categories:**
- Engine Parts & Service
- Electrical
- Plumbing & Water Systems
- Rigging & Deck Hardware
- Safety Equipment
- General Supplies
- Tools
- Consumables
- Other

### supply_units

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| unit_name | text | Unit name |
| abbreviation | text | Short form |

**Default Units:**
- Each (ea), Box (box), Gallon (gal), Quart (qt), Liter (L)
- Feet (ft), Meter (m), Set (set), Pair (pr), Pack (pk)

### supply_system_links

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| supply_id | uuid | FK to supplies |
| asset_uid | text | FK to systems |
| confidence | numeric | AI confidence (0-1) |
| created_at | timestamp | Link creation time |

---

## Key Variables (Frontend)

| Variable | Type | Description |
|----------|------|-------------|
| `pendingBase64Photos` | array | Photos captured but not yet uploaded |
| `photoAnalysisResult` | object | GPT-4V extraction result |
| `currentScreen` | number | Wizard screen (1=photo, 2=details, 3=systems) |
| `supplyData` | object | Form data being built |
| `selectedSystems` | array | Systems user selected for linking |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | For GPT-4V photo analysis |
| `SUPABASE_URL` | Yes | Database connection |
| `SUPABASE_SERVICE_KEY` | Yes | Database auth |

---

## Testing

| Test File | What It Tests |
|-----------|---------------|
| `tests/integration/supplies.test.js` | Supplies API |

---

## What We DON'T Do

| Misconception | Reality |
|---------------|---------|
| "Photos stored locally" | **No.** Supabase Storage |
| "Manual-only entry" | **No.** AI prefills from photo |
| "Supplies are separate from systems" | **No.** Can link to equipment |
| "Single photo only" | **No.** Multi-photo capture with cross-reference |
| "Category required at photo time" | **No.** AI suggests category |

---

## Related Docs

- [Systems](../20-admin-tools/systems.md) - Equipment management
- [Maintenance](./maintenance.md) - Task management
- [Chat](./chat.md) - AI patterns (similar GPT-4V usage)
- [Pinecone](../20-admin-tools/pinecone.md) - System recommendation search
