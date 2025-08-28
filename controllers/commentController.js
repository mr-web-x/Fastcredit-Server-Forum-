// controllers/commentController.js
import commentService from "../services/commentService.js";
import notificationService from "../services/notificationService.js";
import {
  formatResponse,
  getPaginationData,
  isValidObjectId,
} from "../utils/helpers.js";
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "../utils/constants.js";
import { asyncHandler } from "../middlewares/errorHandler.js";
import { logUserAction } from "../middlewares/logger.js";

class CommentController {
  // Получение комментариев к вопросу
  getCommentsForQuestion = asyncHandler(async (req, res) => {
    const { questionId } = req.params;
    const { includeUnapproved = false } = req.query;

    // Валидация questionId
    if (!isValidObjectId(questionId)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID вопроса", {
          type: "VALIDATION_ERROR",
          field: "questionId",
        })
      );
    }

    // Только админы и модераторы могут видеть неодобренные комментарии
    const canSeeUnapproved =
      req.user && (req.user.canModerate || req.user.role === "admin");
    const showUnapproved = includeUnapproved === "true" && canSeeUnapproved;

    const options = {
      includeUnapproved: showUnapproved,
    };

    const comments = await commentService.getCommentsForQuestion(
      questionId,
      options
    );

    res.json(formatResponse(true, comments, "Комментарии к вопросу получены"));
  });

  // Создание комментария к вопросу
  createComment = asyncHandler(async (req, res) => {
    const { questionId } = req.params;
    const { content, parentComment } = req.body;
    const authorId = req.user._id;

    // Валидация questionId
    if (!isValidObjectId(questionId)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID вопроса", {
          type: "VALIDATION_ERROR",
          field: "questionId",
        })
      );
    }

    // Валидация parentComment (если указан)
    if (parentComment && !isValidObjectId(parentComment)) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Неверный формат ID родительского комментария",
          {
            type: "VALIDATION_ERROR",
            field: "parentComment",
          }
        )
      );
    }

    // Валидация контента
    if (!content || content.trim().length < 5) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Комментарий должен содержать минимум 5 символов",
          {
            type: "VALIDATION_ERROR",
            field: "content",
          }
        )
      );
    }

    if (content.trim().length > 1000) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Комментарий должен содержать максимум 1000 символов",
          {
            type: "VALIDATION_ERROR",
            field: "content",
          }
        )
      );
    }

    const commentData = {
      content: content.trim(),
      questionId,
      parentComment: parentComment || null,
    };

    const comment = await commentService.createComment(commentData, authorId);

    // Уведомляем о новом комментарии
    try {
      await notificationService.notifyAboutNewComment(comment._id);
    } catch (notificationError) {
      console.warn(
        "Failed to send comment notifications:",
        notificationError.message
      );
    }

    res
      .status(201)
      .json(formatResponse(true, comment, SUCCESS_MESSAGES.COMMENT_CREATED));
  });

  // Получение ответов на комментарий
  getCommentReplies = asyncHandler(async (req, res) => {
    const { commentId } = req.params;
    const { includeUnapproved = false } = req.query;

    // Валидация commentId
    if (!isValidObjectId(commentId)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID комментария", {
          type: "VALIDATION_ERROR",
          field: "commentId",
        })
      );
    }

    // Только админы и модераторы могут видеть неодобренные ответы
    const canSeeUnapproved =
      req.user && (req.user.canModerate || req.user.role === "admin");
    const showUnapproved = includeUnapproved === "true" && canSeeUnapproved;

    const options = {
      includeUnapproved: showUnapproved,
    };

    const replies = await commentService.getCommentReplies(commentId, options);

    res.json(formatResponse(true, replies, "Ответы на комментарий получены"));
  });

  // Получение комментариев пользователя
  getUserComments = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { page, limit } = getPaginationData(req);
    const { isApproved } = req.query;

    // Валидация userId
    if (!isValidObjectId(userId)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID пользователя", {
          type: "VALIDATION_ERROR",
          field: "userId",
        })
      );
    }

    // Проверяем права: пользователь может смотреть только свои комментарии, админ - любые
    if (userId !== req.user._id.toString() && req.user.role !== "admin") {
      return res
        .status(403)
        .json(formatResponse(false, null, ERROR_MESSAGES.FORBIDDEN));
    }

    const options = {
      page,
      limit,
      isApproved:
        isApproved === "true" ? true : isApproved === "false" ? false : true,
    };

    const comments = await commentService.getUserComments(userId, options);

    res.json(
      formatResponse(true, comments, "Комментарии пользователя получены")
    );
  });

  // Обновление комментария
  updateComment = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user._id;

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID комментария", {
          type: "VALIDATION_ERROR",
          field: "id",
        })
      );
    }

    // Валидация контента
    if (!content || content.trim().length < 5) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Комментарий должен содержать минимум 5 символов",
          {
            type: "VALIDATION_ERROR",
            field: "content",
          }
        )
      );
    }

    if (content.trim().length > 1000) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Комментарий должен содержать максимум 1000 символов",
          {
            type: "VALIDATION_ERROR",
            field: "content",
          }
        )
      );
    }

    const updateData = {
      content: content.trim(),
    };

    const updatedComment = await commentService.updateComment(
      id,
      updateData,
      userId
    );

    res.json(
      formatResponse(true, updatedComment, "Комментарий успешно обновлен")
    );
  });

  // Удаление комментария
  deleteComment = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID комментария", {
          type: "VALIDATION_ERROR",
          field: "id",
        })
      );
    }

    await commentService.deleteComment(id, userId);

    res.json(formatResponse(true, null, "Комментарий успешно удален"));
  });

  // Лайк/дизлайк комментария
  toggleCommentLike = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID комментария", {
          type: "VALIDATION_ERROR",
          field: "id",
        })
      );
    }

    const { default: Like } = await import("../models/Like.js");

    const result = await Like.toggleLike(userId, id, "comment");

    logUserAction(
      userId,
      result.action === "added" ? "COMMENT_LIKED" : "COMMENT_UNLIKED",
      `${result.action} like for comment ${id}`
    );

    res.json(
      formatResponse(
        true,
        {
          liked: result.liked,
          action: result.action,
        },
        result.action === "added"
          ? SUCCESS_MESSAGES.LIKE_ADDED
          : SUCCESS_MESSAGES.LIKE_REMOVED
      )
    );
  });

  // Модерация комментария (только админы)
  moderateComment = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { isApproved } = req.body;
    const moderatorId = req.user._id;

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID комментария", {
          type: "VALIDATION_ERROR",
          field: "id",
        })
      );
    }

    if (typeof isApproved !== "boolean") {
      return res.status(400).json(
        formatResponse(false, null, "Параметр isApproved должен быть boolean", {
          type: "VALIDATION_ERROR",
          field: "isApproved",
        })
      );
    }

    const moderatedComment = await commentService.moderateComment(
      id,
      isApproved,
      moderatorId
    );

    const action = isApproved ? "одобрен" : "отклонен";
    res.json(formatResponse(true, moderatedComment, `Комментарий ${action}`));
  });

  // Получение комментариев на модерации (только админы)
  getPendingComments = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);

    const options = { page, limit };
    const pendingComments = await commentService.getPendingComments(options);

    res.json(
      formatResponse(true, pendingComments, "Комментарии на модерации получены")
    );
  });

  // Поиск комментариев
  searchComments = asyncHandler(async (req, res) => {
    const { q: query } = req.query;
    const { page, limit } = getPaginationData(req);
    const { userId } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Поисковый запрос должен содержать минимум 2 символа",
          {
            type: "VALIDATION_ERROR",
            field: "query",
          }
        )
      );
    }

    // Валидация userId (если указан)
    if (userId && !isValidObjectId(userId)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID пользователя", {
          type: "VALIDATION_ERROR",
          field: "userId",
        })
      );
    }

    const options = {
      page,
      limit,
      userId: userId || null,
    };

    const results = await commentService.searchComments(query.trim(), options);

    res.json(
      formatResponse(true, results, "Результаты поиска комментариев получены")
    );
  });

  // Получение статистики комментариев (только админы)
  getCommentStatistics = asyncHandler(async (req, res) => {
    const statistics = await commentService.getCommentStatistics();

    res.json(
      formatResponse(true, statistics, "Статистика комментариев получена")
    );
  });

  // Получение популярных комментариев
  getPopularComments = asyncHandler(async (req, res) => {
    const { limit = 10, minLikes = 5 } = req.query;

    const options = {
      limit: parseInt(limit),
      minLikes: parseInt(minLikes),
    };

    const popularComments = await commentService.getPopularComments(options);

    res.json(
      formatResponse(true, popularComments, "Популярные комментарии получены")
    );
  });
}

export default new CommentController();
