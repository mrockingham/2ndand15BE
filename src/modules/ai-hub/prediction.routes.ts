import { Router, type RequestHandler } from 'express';
import {
  createRequireAdministrativeCapability,
  type AdministrativeIdentityReader,
} from '../admin/admin-authorization.js';
import { createPredictionController } from './prediction.controller.js';
import type { PredictionService } from './prediction.service.js';
import { createWeeklyInsightsController } from './weekly-insights.controller.js';
import type { AiHubWeeklyInsightsService } from './weekly-insights.service.js';
export function createPredictionRouters(options: {
  authenticate: RequestHandler;
  identities: AdministrativeIdentityReader;
  service: PredictionService;
  weeklyInsightsService?: AiHubWeeklyInsightsService;
}) {
  const controller = createPredictionController(options.service),
    publicRouter = Router(),
    adminRouter = Router();
  publicRouter.get('/predictions', controller.list);
  publicRouter.get('/predictions/:gameId', controller.detail);
  publicRouter.get('/summary', controller.summary);
  publicRouter.get('/performance', controller.performance);
  if (options.weeklyInsightsService !== undefined)
    publicRouter.get(
      '/weekly-insights',
      createWeeklyInsightsController(options.weeklyInsightsService),
    );
  adminRouter.use(options.authenticate);
  const manage = createRequireAdministrativeCapability(options.identities, 'MANAGE_PREDICTIONS');
  adminRouter.post('/generate', manage, controller.generate);
  adminRouter.post('/evaluate', manage, controller.evaluate);
  adminRouter.post('/:predictionId/publish', manage, controller.publish);
  return { publicRouter, adminRouter };
}
