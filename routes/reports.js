// routes/reports.js
import express from 'express';
import reportController from '../controllers/reportController.js';
import { authenticate, requireAdmin } from '../middlewares/auth.js';
import { 
  validateReportCreate,
  validatePagination,
  validateObjectId
} from '../middlewares/validation.js';
import { checkCustomRateLimit } from '../middlewares/rateLimit.js';
import { checkUserBan, checkUserCanPerformAction } from '../middlewares/banCheck.js';

const router = express.Router();

// POST /api/reports - создание жалобы
router.post('/',
  authenticate,
  checkUserBan,
  checkUserCanPerformAction,
  checkCustomRateLimit('report_create'),
  validateReportCreate,
  reportController.createReport
);

// GET /api/reports/my - мои жалобы
router.get('/my',
  authenticate,
  checkUserBan,
  validatePagination,
  reportController.getMyReports
);

// GET /api/reports - все жалобы (только админы)
router.get('/',
  authenticate,
  checkUserBan,
  requireAdmin,
  validatePagination,
  reportController.getAllReports
);

// GET /api/reports/pending - жалобы в ожидании (только админы)
router.get('/pending',
  authenticate,
  checkUserBan,
  requireAdmin,
  validatePagination,
  reportController.getPendingReports
);

// GET /api/reports/statistics - статистика жалоб (только админы)
router.get('/statistics',
  authenticate,
  checkUserBan,
  requireAdmin,
  reportController.getReportStatistics
);

// GET /api/reports/target/:targetType/:targetId - жалобы на конкретный объект
router.get('/target/:targetType/:targetId',
  authenticate,
  checkUserBan,
  requireAdmin,
  validateObjectId('targetId'),
  reportController.getReportsForTarget
);

// GET /api/reports/admin/:adminId - действия админа по жалобам
router.get('/admin/:adminId',
  authenticate,
  checkUserBan,
  requireAdmin,
  validateObjectId('adminId'),
  validatePagination,
  reportController.getAdminReportActions
);

// PUT /api/reports/:id/review - рассмотрение жалобы (только админы)
router.put('/:id/review',
  authenticate,
  checkUserBan,
  requireAdmin,
  validateObjectId('id'),
  reportController.reviewReport
);

// PUT /api/reports/:id/resolve - разрешение жалобы (только админы)
router.put('/:id/resolve',
  authenticate,
  checkUserBan,
  requireAdmin,
  validateObjectId('id'),
  reportController.resolveReport
);

export default router;