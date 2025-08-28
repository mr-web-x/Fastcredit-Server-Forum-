// routes/comments.js
import express from "express";
import commentController from "../controllers/commentController.js";
import {
  authenticate,
  optionalAuth,
  requireAdmin,
} from "../middlewares/auth.js";
import {
  requireModerator,
  requireOwnerOrAdmin,
} from "../middlewares/roleCheck.js";
import {
  createCommentLimiter,
  createLikeLimiter,
  checkCustomRateLimit,
} from "../middlewares/rateLimit.js";
import {
  validateCommentCreate,
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

// GET /api/comments/pending - комментарии на модерации (только админы)
router.get(
  "/pending",
  authenticate,
  checkUserBan,
  requireModerator,
  validatePagination,
  commentController.getPendingComments
);

// GET /api/comments/popular - популярные комментарии
router.get("/popular", optionalAuth, commentController.getPopularComments);

// GET /api/comments/search - поиск комментариев
router.get(
  "/search",
  optionalAuth,
  validateSearch,
  validatePagination,
  commentController.searchComments
);

// GET /api/comments/statistics - статистика комментариев (только админы)
router.get(
  "/statistics",
  authenticate,
  checkUserBan,
  requireAdmin,
  commentController.getCommentStatistics
);

// GET /api/comments/question/:questionId - комментарии к вопросу
router.get(
  "/question/:questionId",
  optionalAuth,
  validateObjectId("questionId"),
  commentController.getCommentsForQuestion
);

// POST /api/comments/question/:questionId - создание комментария к вопросу
router.post(
  "/question/:questionId",
  authenticate,
  checkUserBan,
  checkUserCanPerformAction,
  validateObjectId("questionId"),
  createCommentLimiter(),
  checkCustomRateLimit("comment_create"),
  validateCommentCreate,
  filterContent({
    checkBannedWords: true,
    sanitizeHtml: true,
    checkCapitals: true,
    strictMode: false,
  }),
  checkContentLength({
    content: { min: 5, max: 1000 },
  }),
  checkLinks({ maxLinks: 1, requirePermission: true }), // комментарии ограничены одной ссылкой
  checkSpam({
    threshold: 20, // более низкий порог для комментариев
    checkTitle: false,
    checkContent: true,
    allowForExperts: true,
  }),
  commentController.createComment
);

// GET /api/comments/:commentId/replies - ответы на комментарий
router.get(
  "/:commentId/replies",
  optionalAuth,
  validateObjectId("commentId"),
  commentController.getCommentReplies
);

// GET /api/comments/user/:userId - комментарии пользователя
router.get(
  "/user/:userId",
  authenticate,
  checkUserBan,
  validateObjectId("userId"),
  validatePagination,
  commentController.getUserComments
);

// PUT /api/comments/:id - обновление комментария
router.put(
  "/:id",
  authenticate,
  checkUserBan,
  checkUserCanPerformAction,
  validateObjectId("id"),
  requireOwnerOrAdmin(async (req) => {
    // Получаем автора комментария для проверки владельца
    const { default: Comment } = await import("../models/Comment.js");
    const comment = await Comment.findById(req.params.id);
    return comment?.author;
  }),
  filterContent({
    checkBannedWords: true,
    sanitizeHtml: true,
    checkCapitals: true,
  }),
  checkContentLength({
    content: { min: 5, max: 1000 },
  }),
  commentController.updateComment
);

// DELETE /api/comments/:id - удаление комментария
router.delete(
  "/:id",
  authenticate,
  checkUserBan,
  validateObjectId("id"),
  requireOwnerOrAdmin(async (req) => {
    const { default: Comment } = await import("../models/Comment.js");
    const comment = await Comment.findById(req.params.id);
    return comment?.author;
  }),
  commentController.deleteComment
);

// POST /api/comments/:id/like - лайк/дизлайк комментария
router.post(
  "/:id/like",
  authenticate,
  checkUserBan,
  checkUserCanPerformAction,
  validateObjectId("id"),
  createLikeLimiter(),
  checkCustomRateLimit("like"),
  commentController.toggleCommentLike
);

// POST /api/comments/:id/moderate - модерация комментария (только админы)
router.post(
  "/:id/moderate",
  authenticate,
  checkUserBan,
  requireModerator,
  validateObjectId("id"),
  commentController.moderateComment
);

export default router;
