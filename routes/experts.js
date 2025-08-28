// routes/experts.js
import express from "express";
import expertController from "../controllers/expertController.js";
import { authenticate, optionalAuth } from "../middlewares/auth.js";
import { requireExpert } from "../middlewares/roleCheck.js";
import {
  validateProfileUpdate,
  validateSearch,
  validatePagination,
  validateObjectId,
} from "../middlewares/validation.js";
import {
  checkUserBan,
  checkUserCanPerformAction,
} from "../middlewares/banCheck.js";

const router = express.Router();

// GET /api/experts - список всех экспертов (публичный)
router.get("/", optionalAuth, validatePagination, expertController.getExperts);

// GET /api/experts/search - поиск экспертов (публичный)
router.get(
  "/search",
  optionalAuth,
  validateSearch,
  validatePagination,
  expertController.searchExperts
);

// GET /api/experts/dashboard - панель эксперта (только эксперты)
router.get(
  "/dashboard",
  authenticate,
  checkUserBan,
  requireExpert,
  expertController.getDashboard
);

// GET /api/experts/pending-questions - вопросы в ожидании (только эксперты)
router.get(
  "/pending-questions",
  authenticate,
  checkUserBan,
  requireExpert,
  validatePagination,
  expertController.getPendingQuestions
);

// GET /api/experts/my-answers - мои ответы (только эксперты)
router.get(
  "/my-answers",
  authenticate,
  checkUserBan,
  requireExpert,
  validatePagination,
  expertController.getMyAnswers
);

// GET /api/experts/my-best-answers - мои лучшие ответы (только эксперты)
router.get(
  "/my-best-answers",
  authenticate,
  checkUserBan,
  requireExpert,
  expertController.getMyBestAnswers
);

// PUT /api/experts/bio - обновление биографии эксперта (только эксперты)
router.put(
  "/bio",
  authenticate,
  checkUserBan,
  checkUserCanPerformAction,
  requireExpert,
  validateProfileUpdate,
  expertController.updateExpertBio
);

// GET /api/experts/:expertId - профиль конкретного эксперта (публичный)
router.get(
  "/:expertId",
  optionalAuth,
  validateObjectId("expertId"),
  expertController.getExpertProfile
);

// GET /api/experts/:expertId/activity - активность эксперта (публичная)
router.get(
  "/:expertId/activity",
  optionalAuth,
  validateObjectId("expertId"),
  validatePagination,
  expertController.getExpertActivity
);

// GET /api/experts/:expertId/statistics - статистика эксперта
router.get(
  "/:expertId/statistics",
  authenticate,
  checkUserBan,
  validateObjectId("expertId"),
  expertController.getExpertStatistics
);

export default router;
