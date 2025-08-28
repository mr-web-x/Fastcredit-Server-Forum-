// controllers/answerController.js
import answerService from "../services/answerService.js";
import notificationService from "../services/notificationService.js";
import {
  formatResponse,
  getPaginationData,
  isValidObjectId,
} from "../utils/helpers.js";
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "../utils/constants.js";
import { asyncHandler } from "../middlewares/errorHandler.js";
import { logUserAction } from "../middlewares/logger.js";

class AnswerController {
  // Получение ответов на конкретный вопрос
  getAnswersForQuestion = asyncHandler(async (req, res) => {
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

    // Только админы и модераторы могут видеть неодобренные ответы
    const canSeeUnapproved =
      req.user && (req.user.canModerate || req.user.role === "admin");
    const showUnapproved = includeUnapproved === "true" && canSeeUnapproved;

    const options = {
      includeUnapproved: showUnapproved,
      sortBy: "isAccepted",
      sortOrder: -1,
    };

    const answers = await answerService.getAnswersForQuestion(
      questionId,
      options
    );

    res.json(formatResponse(true, answers, "Ответы на вопрос получены"));
  });

  // Создание ответа на вопрос (только эксперты)
  createAnswer = asyncHandler(async (req, res) => {
    const { questionId } = req.params;
    const { content } = req.body;
    const expertId = req.user._id;

    // Валидация questionId
    if (!isValidObjectId(questionId)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID вопроса", {
          type: "VALIDATION_ERROR",
          field: "questionId",
        })
      );
    }

    // Дополнительная валидация контента
    if (!content || content.trim().length < 50) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Ответ должен содержать минимум 50 символов",
          {
            type: "VALIDATION_ERROR",
            field: "content",
          }
        )
      );
    }

    if (content.trim().length > 10000) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Ответ должен содержать максимум 10000 символов",
          {
            type: "VALIDATION_ERROR",
            field: "content",
          }
        )
      );
    }

    const answerData = {
      content: content.trim(),
      questionId,
    };

    const answer = await answerService.createAnswer(answerData, expertId);

    // Уведомляем автора вопроса о новом ответе
    try {
      await notificationService.notifyQuestionAuthorAboutAnswer(answer._id);
    } catch (notificationError) {
      console.warn(
        "Failed to notify question author:",
        notificationError.message
      );
    }

    res
      .status(201)
      .json(formatResponse(true, answer, SUCCESS_MESSAGES.ANSWER_CREATED));
  });

  // Получение ответов конкретного эксперта
  getExpertAnswers = asyncHandler(async (req, res) => {
    const { expertId } = req.params;
    const { page, limit } = getPaginationData(req);
    const { isApproved } = req.query;

    // Проверяем права: эксперт может смотреть только свои ответы, админ - любые
    if (expertId !== req.user._id.toString() && req.user.role !== "admin") {
      return res
        .status(403)
        .json(formatResponse(false, null, ERROR_MESSAGES.FORBIDDEN));
    }

    const options = {
      page,
      limit,
      isApproved:
        isApproved === "true" ? true : isApproved === "false" ? false : null,
    };

    const answers = await answerService.getExpertAnswers(expertId, options);

    res.json(formatResponse(true, answers, "Ответы эксперта получены"));
  });

  // Обновление ответа
  updateAnswer = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user._id;

    if (!content || content.trim().length < 50) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Ответ должен содержать минимум 50 символов",
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

    const updatedAnswer = await answerService.updateAnswer(
      id,
      updateData,
      userId
    );

    res.json(formatResponse(true, updatedAnswer, "Ответ успешно обновлен"));
  });

  // Удаление ответа
  deleteAnswer = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    await answerService.deleteAnswer(id, userId);

    res.json(formatResponse(true, null, "Ответ успешно удален"));
  });

  // Модерация ответа (только админы)
  moderateAnswer = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { isApproved, comment } = req.body;
    const moderatorId = req.user._id;

    if (typeof isApproved !== "boolean") {
      return res.status(400).json(
        formatResponse(false, null, "Параметр isApproved должен быть boolean", {
          type: "VALIDATION_ERROR",
          field: "isApproved",
        })
      );
    }

    const moderatedAnswer = await answerService.moderateAnswer(
      id,
      isApproved,
      moderatorId,
      comment
    );

    // Уведомляем эксперта о результате модерации
    try {
      await notificationService.notifyExpertAboutAnswerApproval(id, isApproved);
    } catch (notificationError) {
      console.warn(
        "Failed to notify expert about moderation:",
        notificationError.message
      );
    }

    const action = isApproved ? "одобрен" : "отклонен";
    res.json(formatResponse(true, moderatedAnswer, `Ответ ${action}`));
  });

  // Принятие ответа как лучшего (только автор вопроса)
  acceptAnswer = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    const acceptedAnswer = await answerService.acceptAnswer(id, userId);

    // Уведомляем эксперта о принятии ответа
    try {
      await notificationService.notifyExpertAboutAnswerAcceptance(id);
    } catch (notificationError) {
      console.warn(
        "Failed to notify expert about acceptance:",
        notificationError.message
      );
    }

    res.json(formatResponse(true, acceptedAnswer, "Ответ принят как лучший"));
  });

  // Лайк/дизлайк ответа
  toggleAnswerLike = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    const { default: Like } = await import("../models/Like.js");

    const result = await Like.toggleLike(userId, id, "answer");

    logUserAction(
      userId,
      result.action === "added" ? "ANSWER_LIKED" : "ANSWER_UNLIKED",
      `${result.action} like for answer ${id}`
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

  // Получение ответов на модерации (только админы)
  getPendingAnswers = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);

    const options = { page, limit };
    const pendingAnswers = await answerService.getPendingAnswers(options);

    res.json(
      formatResponse(true, pendingAnswers, "Ответы на модерации получены")
    );
  });

  // Получение статистики ответов (только админы)
  getAnswerStatistics = asyncHandler(async (req, res) => {
    const statistics = await answerService.getAnswerStatistics();

    res.json(formatResponse(true, statistics, "Статистика ответов получена"));
  });

  // Получение лучших ответов эксперта
  getExpertBestAnswers = asyncHandler(async (req, res) => {
    const { expertId } = req.params;
    const { limit = 10 } = req.query;

    const bestAnswers = await answerService.getExpertBestAnswers(
      expertId,
      parseInt(limit)
    );

    res.json(
      formatResponse(true, bestAnswers, "Лучшие ответы эксперта получены")
    );
  });

  // Массовая модерация ответов (только админы)
  bulkModerateAnswers = asyncHandler(async (req, res) => {
    const { answerIds, isApproved, comment } = req.body;
    const moderatorId = req.user._id;

    if (!Array.isArray(answerIds) || answerIds.length === 0) {
      return res.status(400).json(
        formatResponse(false, null, "Список ID ответов обязателен", {
          type: "VALIDATION_ERROR",
          field: "answerIds",
        })
      );
    }

    if (answerIds.length > 50) {
      return res.status(400).json(
        formatResponse(false, null, "Максимум 50 ответов за раз", {
          type: "VALIDATION_ERROR",
          field: "answerIds",
        })
      );
    }

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (const answerId of answerIds) {
      try {
        await answerService.moderateAnswer(
          answerId,
          isApproved,
          moderatorId,
          comment
        );
        results.push({ answerId, success: true });
        successCount++;
      } catch (error) {
        results.push({ answerId, success: false, error: error.message });
        errorCount++;
      }
    }

    logUserAction(
      moderatorId,
      "BULK_ANSWER_MODERATION",
      `Moderated ${successCount} answers (${errorCount} errors)`
    );

    res.json(
      formatResponse(
        true,
        {
          results,
          summary: {
            total: answerIds.length,
            success: successCount,
            errors: errorCount,
          },
        },
        `Массовая модерация завершена: ${successCount} успешно, ${errorCount} ошибок`
      )
    );
  });
}

export default new AnswerController();
