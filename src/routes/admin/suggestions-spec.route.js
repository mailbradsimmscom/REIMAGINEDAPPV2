import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { AcceptSpecPayload } from '../../schemas/suggestions.schema.js';
import suggestionsMergeService from '../../services/suggestions.merge.service.js';
import { adminOnly } from '../../middleware/admin.js';
import { logger } from '../../utils/logger.js';

const router = Router();

// Simple in-memory idempotency; replace with DB if needed
const seen = new Map();

/**
 * POST /admin/api/suggestions/spec/accept
 * Accept a spec suggestion and merge it into production
 */
router.post('/spec/accept', adminOnly, validate(AcceptSpecPayload), async (req, res, next) => {
  try {
    const { suggestionId, systemUid, spec, idempotencyKey } = req.body;
    const actor = req.user?.email ?? 'admin'; // adjust to your auth

    if (seen.has(idempotencyKey)) {
      return res.json({ ok: true, deduped: true });
    }

    const result = await suggestionsMergeService.acceptSpecSuggestion({ 
      suggestionId, 
      systemUid, 
      spec, 
      actor 
    });
    seen.set(idempotencyKey, true);

    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, 'spec.accept failed');
    next(err);
  }
});

export default router;
