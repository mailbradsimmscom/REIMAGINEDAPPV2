import express from 'express';
import { validate } from '../../middleware/validate.js';
import { validateResponse } from '../../middleware/validateResponse.js';
import { AdminLogsEnvelope, adminLogsQuerySchema } from '../../schemas/admin.schema.js';
import { getLogs, getLogMetadata } from '../../services/logs.service.js';

const router = express.Router();

// Apply response validation to all routes in this file
router.use(validateResponse(AdminLogsEnvelope));

// GET /admin/logs - Get log files
router.get('/',
  validate(adminLogsQuerySchema, 'query'),
  async (req, res, next) => {
  try {
    const { level, service, module, correlationId, limit, search } = req.query;

    // Get logs with filters
    const result = await getLogs({
      level,
      service,
      module,
      correlationId,
      limit: limit ? parseInt(limit) : 100,
      search
    });

    const logsData = {
      logs: result.logs,
      count: result.returned,
      timestamp: new Date().toISOString()
    };

    const envelope = {
      success: true,
      data: logsData
    };

    return res.json(envelope);
  } catch (error) {
    next(error);
  }
});

// GET /admin/logs/metadata - Get available services, modules, levels
router.get('/metadata', async (req, res, next) => {
  try {
    const metadata = await getLogMetadata();

    const envelope = {
      success: true,
      data: metadata
    };

    return res.json(envelope);
  } catch (error) {
    next(error);
  }
});

// Method not allowed for all other methods
router.all('/', (req, res) => {
  return res.json({
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: `${req.method} not allowed`
    }
  }, 405);
});

export default router;
