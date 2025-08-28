// routes/answers.js
import express from "express";
import answerController from "../controllers/answerController.js";
import {
  authenticate,
  optionalAuth,
  requireAdmin,
} from "../middlewares/auth.js";
import {
  requireModerator,
  requireOwnerOrAdmin,
  requireQuestionAuthorOrAdmin,
} from "../middlewares/roleCheck.js";
import {
  createAnswerLimiter,
  createLikeLimiter,
  checkCustomRateLimit,
} from "../middlewares/rateLimit.js";
import {
  validateAnswerCreate,
  validatePagination,
  validateObjectId,
} from "../middlewares/validation.js";
import { checkSpam } from "../middlewares/spamProtection.js";
import {
  filterContent,
  checkContentLength,
} from "../middlewares/contentFilter.js";
import {
  checkUserBan,
  checkUserCanPerformAction,
} from "../middlewares/banCheck.js";

const router = express.Router();

// GET /api/answers/question/:questionId - получение ответов на вопрос
router.get(
  "/question/:questionId",
  optionalAuth,
  validateObjectId("questionId"),
  answerController.getAnswersForQuestion
);

// POST /api/answers/question/:questionId - создание ответа (только эксперты)
router.post(
  "/question/:questionId",
  authenticate,
  checkUserBan,
  checkUserCanPerformAction,
  validateObjectId("questionId"),
  createAnswerLimiter(), // проверяет роль эксперта внутри
  checkCustomRateLimit("answer_create"),
  validateAnswerCreate,
  filterContent({
    checkBannedWords: true,
    sanitizeHtml: true,
    checkCapitals: true,
  }),
  checkContentLength({
    content: { min: 50, max: 10000 },
  }),
  checkSpam({
    threshold: 30,
    checkTitle: false,
    checkContent: true,
    allowForExperts: true,
  }),
  answerController.createAnswer
);

// GET /api/answers/expert/:expertId - ответы эксперта
router.get(
  "/expert/:expertId",
  authenticate,
  checkUserBan,
  validateObjectId("expertId"),
  validatePagination,
  answerController.getExpertAnswers
);

// GET /api/answers/expert/:expertId/best - лучшие ответы эксперта
router.get(
  "/expert/:expertId/best",
  optionalAuth,
  validateObjectId("expertId"),
  answerController.getExpertBestAnswers
);

// PUT /api/answers/:id - обновление ответа
router.put(
  "/:id",
  authenticate,
  checkUserBan,
  checkUserCanPerformAction,
  validateObjectId("id"),
  requireOwnerOrAdmin(async (req) => {
    const { default: Answer } = await import("../models/Answer.js");
    const answer = await Answer.findById(req.params.id);
    return answer?.expert;
  }),
  filterContent({
    checkBannedWords: true,
    sanitizeHtml: true,
  }),
  checkContentLength({
    content: { min: 50, max: 10000 },
  }),
  answerController.updateAnswer
);

// DELETE /api/answers/:id - удаление ответа
router.delete(
  "/:id",
  authenticate,
  checkUserBan,
  validateObjectId("id"),
  requireOwnerOrAdmin(async (req) => {
    const { default: Answer } = await import("../models/Answer.js");
    const answer = await Answer.findById(req.params.id);
    return answer?.expert;
  }),
  answerController.deleteAnswer
);

// POST /api/answers/:id/accept - принятие ответа как лучшего
router.post(
  "/:id/accept",
  authenticate,
  checkUserBan,
  checkUserCanPerformAction,
  validateObjectId("id"),
  requireQuestionAuthorOrAdmin(async (req) => {
    const { default: Answer } = await import("../models/Answer.js");
    const { default: Question } = await import("../models/Question.js");
    const answer = await Answer.findById(req.params.id).populate("questionId");
    return answer?.questionId?.author;
  }),
  answerController.acceptAnswer
);

// POST /api/answers/:id/like - лайк ответа
router.post(
  "/:id/like",
  authenticate,
  checkUserBan,
  checkUserCanPerformAction,
  validateObjectId("id"),
  createLikeLimiter(),
  checkCustomRateLimit("like"),
  answerController.toggleAnswerLike
);

// GET /api/answers/pending - ответы на модерации (только админы)
router.get(
  "/pending",
  authenticate,
  checkUserBan,
  requireModerator,
  validatePagination,
  answerController.getPendingAnswers
);

// POST /api/answers/:id/moderate - модерация ответа (только админы)
router.post(
  "/:id/moderate",
  authenticate,
  checkUserBan,
  requireModerator,
  validateObjectId("id"),
  answerController.moderateAnswer
);

// POST /api/answers/bulk-moderate - массовая модерация (только админы)
router.post(
  "/bulk-moderate",
  authenticate,
  checkUserBan,
  requireModerator,
  answerController.bulkModerateAnswers
);

// GET /api/answers/statistics - статистика (только админы)
router.get(
  "/statistics",
  authenticate,
  checkUserBan,
  requireAdmin,
  answerController.getAnswerStatistics
);

export default router;
