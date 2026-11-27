import { Router } from 'express';
import { AnalyzeRequestSchema } from '../domain/schema.js';
import { AppError } from '../errors.js';
import { analyzeIntake, type AnalyzeDeps } from '../services/analyze.js';

/** `POST /api/analyze` — validates the Intake and returns a verified Action Card. */
export function analyzeRouter(deps: AnalyzeDeps): Router {
  const router = Router();

  router.post('/analyze', async (req, res) => {
    const parsed = AnalyzeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        undefined,
        parsed.error.issues.slice(0, 10).map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
      );
    }

    const { card, cached } = await analyzeIntake(parsed.data, req.requestId, deps);
    deps.logger.info('action card created', {
      requestId: req.requestId,
      cached,
      severity: card.severity,
      domain: card.domain,
      verification: card.verification.status,
      files: parsed.data.files.length,
      latencyMs: card.meta.latencyMs,
    });
    res.setHeader('X-Cache', cached ? 'HIT' : 'MISS');
    res.setHeader('Cache-Control', 'no-store');
    res.json(card);
  });

  return router;
}
