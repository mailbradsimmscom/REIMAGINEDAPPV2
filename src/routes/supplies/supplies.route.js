// src/routes/supplies/supplies.route.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import * as suppliesService from '../../services/supplies/supplies.service.js';
import * as aiAnalysisService from '../../services/supplies/ai-analysis.service.js';
import * as photoStorageService from '../../services/supplies/photo-storage.service.js';
import { getSupabaseClient } from '../../repositories/supabaseClient.js';
import { listMinimal as listMinimalSystems } from '../../repositories/systems.repository.js';
import { logger } from '../../utils/logger.js';

const router = express.Router();

// Configure multer for photo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.cwd(), 'uploads/supplies'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `supply-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (!file.originalname.match(/\.(jpg|JPG|jpeg|JPEG|png|PNG|gif|GIF|webp|WEBP)$/)) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  }
});

/**
 * GET /api/supplies
 * List supplies with filtering and pagination
 */
router.get('/', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const options = {
      limit: req.query.limit,
      offset: req.query.offset,
      categoryId: req.query.categoryId,
      location: req.query.location,
      systemAssetUid: req.query.systemAssetUid,
      lowStock: req.query.lowStock === 'true',
      itemType: req.query.itemType,
      orderBy: req.query.orderBy,
      ascending: req.query.ascending !== 'false'
    };

    const result = await suppliesService.listSupplies(options);

    return res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error listing supplies', { error: error.message });
    return res.status(error.status || 500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /api/supplies/search
 * Full-text search supplies
 */
router.get('/search', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { q, limit, offset } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter "q" is required',
        requestId: res.locals.requestId
      });
    }

    const result = await suppliesService.searchSupplies(q, { limit, offset });

    return res.json({
      success: true,
      data: result.data,
      query: result.query,
      pagination: result.pagination,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error searching supplies', { error: error.message, query: req.query.q });
    return res.status(error.status || 500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /api/supplies/low-stock
 * Get supplies at or below reorder threshold
 */
router.get('/low-stock', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const autoReorderOnly = req.query.autoReorderOnly === 'true';

    const result = await suppliesService.getLowStockSupplies(autoReorderOnly);

    return res.json({
      success: true,
      data: result.data,
      count: result.count,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting low stock supplies', { error: error.message });
    return res.status(error.status || 500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /api/supplies/category/:categoryId
 * Get supplies by category
 */
router.get('/category/:categoryId', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { categoryId } = req.params;

    const result = await suppliesService.getSuppliesByCategory(categoryId);

    return res.json({
      success: true,
      data: result.data,
      count: result.count,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting supplies by category', {
      error: error.message,
      categoryId: req.params.categoryId
    });
    return res.status(error.status || 500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /api/supplies/system/:assetUid
 * Get supplies by system
 */
router.get('/system/:assetUid', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { assetUid } = req.params;

    const result = await suppliesService.getSuppliesBySystem(assetUid);

    return res.json({
      success: true,
      data: result.data,
      count: result.count,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting supplies by system', {
      error: error.message,
      assetUid: req.params.assetUid
    });
    return res.status(error.status || 500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /api/supplies/systems
 * Get all boat systems for manual selection
 */
router.get('/systems', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const systems = await listMinimalSystems();

    // Transform to a user-friendly format with display name
    const formatted = systems.map(s => ({
      asset_uid: s.asset_uid,
      display_name: s.system_norm || `${s.manufacturer_norm} ${s.model_norm}`.trim(),
      manufacturer: s.manufacturer_norm,
      model: s.model_norm
    }));

    requestLogger.info('Listed systems for supplies', { count: formatted.length });

    return res.json({
      success: true,
      data: formatted,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error listing systems', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * GET /api/supplies/:id
 * Get single supply by ID
 */
router.get('/:id', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;

    const result = await suppliesService.getSupplyById(id);

    return res.json({
      success: true,
      data: result.data,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error getting supply', { error: error.message, id: req.params.id });
    return res.status(error.status || 500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/supplies
 * Create new supply item
 */
router.post('/', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const result = await suppliesService.createSupply(req.body);

    return res.status(201).json({
      success: true,
      data: result.data,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error creating supply', { error: error.message });
    return res.status(error.status || 500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * PUT /api/supplies/:id
 * Update supply item
 */
router.put('/:id', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;

    const result = await suppliesService.updateSupply(id, req.body);

    return res.json({
      success: true,
      data: result.data,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error updating supply', { error: error.message, id: req.params.id });
    return res.status(error.status || 500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * DELETE /api/supplies/:id
 * Delete supply item
 */
router.delete('/:id', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;

    const result = await suppliesService.deleteSupply(id);

    return res.json({
      success: true,
      message: result.message,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error deleting supply', { error: error.message, id: req.params.id });
    return res.status(error.status || 500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/supplies/analyze-photo
 * Analyze a supply photo using GPT-4V
 * Accepts either imageBase64 (data URL) or photoUrl (file path)
 */
router.post('/analyze-photo', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { imageBase64, photoUrl } = req.body;

    if (!imageBase64 && !photoUrl) {
      return res.status(400).json({
        success: false,
        error: 'Either imageBase64 or photoUrl is required',
        requestId: res.locals.requestId
      });
    }

    requestLogger.info('Analyzing photo', {
      hasBase64: !!imageBase64,
      photoUrl: photoUrl || 'N/A'
    });

    // Fetch real categories and units from database for AI prompt
    const supabase = await getSupabaseClient();
    const [categoriesResult, unitsResult] = await Promise.all([
      supabase.from('supply_categories').select('category_name').order('category_name'),
      supabase.from('supply_units').select('unit_name, abbreviation').order('unit_name')
    ]);

    const categories = (categoriesResult.data || []).map(c => c.category_name);
    const units = (unitsResult.data || []).map(u => `${u.unit_name} (${u.abbreviation})`);

    // Use base64 directly if provided, otherwise fall back to file path
    const result = imageBase64
      ? await aiAnalysisService.analyzeSupplyPhotoBase64(imageBase64, { categories, units })
      : await aiAnalysisService.analyzeSupplyPhoto(photoUrl, { categories, units });

    return res.json({
      success: result.success,
      data: result.data,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error analyzing photo', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/supplies/analyze-photos
 * Analyze MULTIPLE supply photos using GPT Vision (multi-image call)
 * All photos are analyzed together for cross-referencing
 */
router.post('/analyze-photos', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { imageBase64Array } = req.body;

    // Validate input
    if (!imageBase64Array || !Array.isArray(imageBase64Array) || imageBase64Array.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'imageBase64Array must be a non-empty array of base64 image data URLs',
        requestId: res.locals.requestId
      });
    }

    // Limit to 5 photos max to avoid token limits
    if (imageBase64Array.length > 5) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 5 photos allowed per analysis',
        requestId: res.locals.requestId
      });
    }

    requestLogger.info('Analyzing multiple photos', {
      photoCount: imageBase64Array.length
    });

    // Fetch real categories and units from database for AI prompt
    const supabase = await getSupabaseClient();
    const [categoriesResult, unitsResult] = await Promise.all([
      supabase.from('supply_categories').select('category_name').order('category_name'),
      supabase.from('supply_units').select('unit_name, abbreviation').order('unit_name')
    ]);

    const categories = (categoriesResult.data || []).map(c => c.category_name);
    const units = (unitsResult.data || []).map(u => `${u.unit_name} (${u.abbreviation})`);

    // Analyze all photos together
    const result = await aiAnalysisService.analyzeMultipleSupplyPhotos(imageBase64Array, { categories, units });

    return res.json({
      success: result.success,
      data: result.data,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error analyzing multiple photos', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/supplies/suggest-systems
 * Suggest boat systems relevant to a supply item
 */
router.post('/suggest-systems', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { item_name, brand, part_number, category } = req.body;

    if (!item_name && !brand && !part_number) {
      return res.status(400).json({
        success: false,
        error: 'At least one of item_name, brand, or part_number is required',
        requestId: res.locals.requestId
      });
    }

    requestLogger.info('Suggesting systems', { item_name, brand, part_number, category });

    const result = await aiAnalysisService.suggestSystemsForSupply(req.body);

    return res.json({
      success: result.success,
      data: result.data,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error suggesting systems', { error: error.message, itemData: req.body });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/supplies/upload-photo
 * Upload a photo for a supply item (disk-based, legacy)
 */
router.post('/upload-photo', upload.single('photo'), async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No photo file provided',
        requestId: res.locals.requestId
      });
    }

    // Generate URL for the uploaded photo
    const photoUrl = `/uploads/supplies/${req.file.filename}`;

    requestLogger.info('Photo uploaded successfully', {
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype
    });

    return res.json({
      success: true,
      data: {
        url: photoUrl,
        filename: req.file.filename,
        size: req.file.size
      },
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error uploading photo', { error: error.message });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

/**
 * POST /api/supplies/:id/photo
 * Upload a photo to Supabase Storage for a supply item
 * Body: { imageBase64: "data:image/jpeg;base64,..." }
 */
router.post('/:id/photo', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { id } = req.params;
    const { imageBase64, photoIndex = 1 } = req.body;

    if (!imageBase64) {
      return res.status(400).json({
        success: false,
        error: 'imageBase64 is required',
        requestId: res.locals.requestId
      });
    }

    requestLogger.info('Uploading photo to Supabase Storage', {
      supplyId: id,
      photoIndex,
      hasBase64: !!imageBase64
    });

    // Upload to Supabase Storage
    const photoUrl = await photoStorageService.uploadSupplyPhoto(id, imageBase64, photoIndex);

    // Update supply with photo URL
    const supply = await suppliesService.getSupplyById(id);
    const existingPhotos = supply.data?.photos || [];

    // Replace photo at index or append
    const updatedPhotos = [...existingPhotos];
    updatedPhotos[photoIndex - 1] = photoUrl;

    await suppliesService.updateSupply(id, { photos: updatedPhotos });

    requestLogger.info('Photo uploaded and supply updated', {
      supplyId: id,
      photoUrl,
      totalPhotos: updatedPhotos.length
    });

    return res.json({
      success: true,
      data: {
        url: photoUrl,
        photos: updatedPhotos
      },
      requestId: res.locals.requestId
    });

  } catch (error) {
    requestLogger.error('Error uploading photo to storage', {
      error: error.message,
      supplyId: req.params.id
    });
    return res.status(500).json({
      success: false,
      error: error.message,
      requestId: res.locals.requestId
    });
  }
});

export default router;
