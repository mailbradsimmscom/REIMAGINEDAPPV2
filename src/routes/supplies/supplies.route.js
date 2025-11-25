// src/routes/supplies/supplies.route.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import * as suppliesService from '../../services/supplies/supplies.service.js';
import * as aiAnalysisService from '../../services/supplies/ai-analysis.service.js';
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
 */
router.post('/analyze-photo', async (req, res) => {
  const requestLogger = logger.createRequestLogger();

  try {
    const { photoUrl } = req.body;

    if (!photoUrl) {
      return res.status(400).json({
        success: false,
        error: 'Photo URL is required',
        requestId: res.locals.requestId
      });
    }

    requestLogger.info('Analyzing photo', { photoUrl });

    const result = await aiAnalysisService.analyzeSupplyPhoto(photoUrl);

    return res.json({
      success: result.success,
      data: result.data,
      requestId: res.locals.requestId
    });
  } catch (error) {
    requestLogger.error('Error analyzing photo', { error: error.message, photoUrl: req.body.photoUrl });
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
 * Upload a photo for a supply item
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

export default router;
