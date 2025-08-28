// routes/questions.js
import express from "express";
import questionController from "../controllers/questionController.js";
import {
  authenticate,
  optionalAuth,
  requireAdmin,
} from "../middlewares/auth.js";
import { requireOwnerOrAdmin } from "../middlewares/roleCheck.js";
import {
  createQuestionLimiter,
  createLikeLimiter,
  checkCustomRateLimit,
} from "../middlewares/rateLimit.js";
import {
  validateQuestionCreate,
  validateQuestionUpdate,
  validateSearch,
  validatePagination,
  validateObjectId,
} from "../middlewares/validation.js";
import { checkSpam } from "../middlewares/spamProtection.js";
import {
  filterContent,
  checkContentLength,
  checkLinks,
} from "../middlewares/contentFilter.js";
import {
  checkUserBan,
  checkUserCanPerformAction,
} from "../middlewares/banCheck.js";

const router = express.Router();

// GET /api/questions - получение всех вопросов с фильтрами
router.get(
  "/",
  optionalAuth,
  validatePagination,
  questionController.getQuestions
);

// GET /api/questions/pending - вопросы в ожидании ответа (для экспертов)
router.get(
  "/pending",
  authenticate,
  checkUserBan,
  validatePagination,
  questionController.getPendingQuestions
);

// GET /api/questions/search - поиск вопросов
router.get(
  "/search",
  optionalAuth,
  validateSearch,
  validatePagination,
  questionController.searchQuestions
);

// GET /api/questions/statistics - статистика вопросов (только админы)
router.get(
  "/statistics",
  authenticate,
  checkUserBan,
  requireAdmin,
  questionController.getQuestionStatistics
);

// POST /api/questions - создание нового вопроса
router.post(
  "/",
  authenticate,
  checkUserBan,
  checkUserCanPerformAction,
  createQuestionLimiter(),
  checkCustomRateLimit("question_create"),
  validateQuestionCreate,
  filterContent({
    checkBannedWords: true,
    sanitizeHtml: true,
    checkCapitals: true,
    strictMode: false,
  }),
  checkContentLength({
    title: { min: 10, max: 200 },
    content: { min: 20, max: 5000 },
  }),
  checkLinks({ maxLinks: 2, requirePermission: true }),
  checkSpam({
    threshold: 30,
    checkTitle: true,
    checkContent: true,
    allowForExperts: true,
  }),
  questionController.createQuestion
);

// GET /api/questions/validate-slug/:slug - валидация slug вопроса
router.get("/validate-slug/:slug", questionController.validateQuestionSlug);

// GET /api/questions/:slug - получение конкретного вопроса
router.get("/:slug", optionalAuth, questionController.getQuestionBySlug);

// PUT /api/questions/:id - обновление вопроса
router.put(
  "/:id",
  authenticate,
  checkUserBan,
  checkUserCanPerformAction,
  validateObjectId("id"),
  validateQuestionUpdate,
  requireOwnerOrAdmin(async (req) => {
    // Получаем автора вопроса для проверки владельца
    const { default: Question } = await import("../models/Question.js");
    const question = await Question.findById(req.params.id);
    return question?.author;
  }),
  filterContent({
    checkBannedWords: true,
    sanitizeHtml: true,
    checkCapitals: true,
  }),
  checkContentLength({
    title: { min: 10, max: 200 },
    content: { min: 20, max: 5000 },
  }),
  questionController.updateQuestion
);

// DELETE /api/questions/:id - удаление вопроса
router.delete(
  "/:id",
  authenticate,
  checkUserBan,
  validateObjectId("id"),
  requireOwnerOrAdmin(async (req) => {
    const { default: Question } = await import("../models/Question.js");
    const question = await Question.findById(req.params.id);
    return question?.author;
  }),
  questionController.deleteQuestion
);

// POST /api/questions/:id/like - лайк/дизлайк вопроса
router.post(
  "/:id/like",
  authenticate,
  checkUserBan,
  checkUserCanPerformAction,
  validateObjectId("id"),
  createLikeLimiter(),
  checkCustomRateLimit("like"),
  questionController.toggleQuestionLike
);

// GET /api/questions/:id/similar - похожие вопросы
router.get(
  "/:id/similar",
  optionalAuth,
  validateObjectId("id"),
  questionController.getSimilarQuestions
);

// PUT /api/questions/:id/status - изменение статуса вопроса (только админы)
router.put(
  "/:id/status",
  authenticate,
  checkUserBan,
  requireAdmin,
  validateObjectId("id"),
  questionController.changeQuestionStatus
);

// GET /api/questions/user/:userId - вопросы конкретного пользователя
router.get(
  "/user/:userId",
  authenticate,
  checkUserBan,
  validateObjectId("userId"),
  validatePagination,
  questionController.getUserQuestions
);

export default router;
