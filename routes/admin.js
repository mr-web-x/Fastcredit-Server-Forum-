// routes/admin.js
import express from 'express';
import adminController from '../controllers/adminController.js';
import { authenticate, requireAdmin } from '../middlewares/auth.js';
import { requireModerator } from '../middlewares/roleCheck.js';
import { 
  validatePagination,
  validateObjectId
} from '../middlewares/validation.js';
import { checkUserBan } from '../middlewares/banCheck.js';

const router = express.Router();

// GET /api/admin - главная панель админки
router.get('/',
  authenticate,
  checkUserBan,
  requireAdmin,
  adminController.getDashboard
);

// GET /api/admin/statistics - статистика форума
router.get('/statistics',
  authenticate,
  checkUserBan,
  requireAdmin,
  adminController.getForumStatistics
);

// GET /api/admin/questions - модерация вопросов
router.get('/questions',
  authenticate,
  checkUserBan,
  requireModerator,
  validatePagination,
  adminController.getQuestionsModerationQueue
);

// PUT /api/admin/questions/:id - модерация конкретного вопроса
router.put('/questions/:id',
  authenticate,
  checkUserBan,
  requireModerator,
  validateObjectId('id'),
  adminController.moderateQuestion
);

// GET /api/admin/answers - модерация ответов
router.get('/answers',
  authenticate,
  checkUserBan,
  requireModerator,
  validatePagination,
  adminController.getAnswersModerationQueue
);

// GET /api/admin/comments - модерация комментариев
router.get('/comments',
  authenticate,
  checkUserBan,
  requireModerator,
  validatePagination,
  adminController.getCommentsModerationQueue
);

// POST /api/admin/bulk-moderate - массовая модерация контента
router.post('/bulk-moderate',
  authenticate,
  checkUserBan,
  requireModerator,
  adminController.bulkModerateContent
);

// GET /api/admin/users - управление пользователями
router.get('/users',
  authenticate,
  checkUserBan,
  requireAdmin,
  validatePagination,
  adminController.getUsers
);

// GET /api/admin/role-changes - история изменений ролей
router.get('/role-changes',
  authenticate,
  checkUserBan,
  requireAdmin,
  validatePagination,
  adminController.getRoleChangesHistory
);

// GET /api/admin/role-transitions - переходы ролей
router.get('/role-transitions',
  authenticate,
  checkUserBan,
  requireAdmin,
  adminController.getRoleTransitions
);

// GET /api/admin/spam-analysis - анализ спам контента
router.get('/spam-analysis',
  authenticate,
  checkUserBan,
  requireAdmin,
  adminController.analyzeSpamContent
);

// GET /api/admin/user-behavior/:userId - анализ поведения пользователя
router.get('/user-behavior/:userId',
  authenticate,
  checkUserBan,
  requireAdmin,
  validateObjectId('userId'),
  adminController.analyzeUserBehavior
);

// GET /api/admin/rate-limits - статистика rate limiting
router.get('/rate-limits',
  authenticate,
  checkUserBan,
  requireAdmin,
  adminController.getRateLimitStatistics
);

// GET /api/admin/rate-limit-violators - нарушители лимитов
router.get('/rate-limit-violators',
  authenticate,
  checkUserBan,
  requireAdmin,
  validatePagination,
  adminController.getUsersExceedingLimits
);

// POST /api/admin/reset-rate-limits/:userId - сброс лимитов пользователя
router.post('/reset-rate-limits/:userId',
  authenticate,
  checkUserBan,
  requireAdmin,
  validateObjectId('userId'),
  adminController.resetUserRateLimits
);

export default router;