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
        formatResponse(false, null, "Neplatný formát ID otázky", {
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

    res.json(formatResponse(true, answers, "Odpovede na otázku boli prijaté"));
  });

  // Создание ответа на вопрос (только эксперты)
  createAnswer = asyncHandler(async (req, res) => {
    const { questionId } = req.params;
    const { content } = req.body;
    const expertId = req.user._id;

    // Валидация questionId
    if (!isValidObjectId(questionId)) {
      return res.status(400).json(
        formatResponse(false, null, "Neplatný formát ID otázky", {
          type: "VALIDATION_ERROR",
          field: "questionId",
        })
      );
    }

    // Дополнительная валидация контента
    if (!content || content.trim().length < 50) {
      return res.status(400).json(
        formatResponse(false, null, "Odpoveď musí obsahovať aspoň 50 znakov", {
          type: "VALIDATION_ERROR",
          field: "content",
        })
      );
    }

    if (content.trim().length > 10000) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Odpoveď môže obsahovať maximálne 10000 znakov",
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
        "Nepodarilo sa upozorniť autora otázky:",
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

    res.json(formatResponse(true, answers, "Odpovede experta boli prijaté"));
  });

  // Обновление ответа
  updateAnswer = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user._id;

    if (!content || content.trim().length < 50) {
      return res.status(400).json(
        formatResponse(false, null, "Odpoveď musí obsahovať aspoň 50 znakov", {
          type: "VALIDATION_ERROR",
          field: "content",
        })
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

    res.json(
      formatResponse(true, updatedAnswer, "Odpoveď bola úspešne aktualizovaná")
    );
  });

  // Удаление ответа
  deleteAnswer = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    await answerService.deleteAnswer(id, userId);

    res.json(formatResponse(true, null, "Odpoveď bola úspešne odstránená"));
  });

  // Модерация ответа (только админы)
  moderateAnswer = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { isApproved, comment } = req.body;
    const moderatorId = req.user._id;

    if (typeof isApproved !== "boolean") {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Parameter isApproved musí byť typu boolean",
          {
            type: "VALIDATION_ERROR",
            field: "isApproved",
          }
        )
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
        "Nepodarilo sa upozorniť experta o moderácii:",
        notificationError.message
      );
    }

    const action = isApproved ? "schválená" : "zamietnutá";
    res.json(formatResponse(true, moderatedAnswer, `Odpoveď bola ${action}`));
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
        "Nepodarilo sa upozorniť experta o prijatí odpovede:",
        notificationError.message
      );
    }

    res.json(
      formatResponse(true, acceptedAnswer, "Odpoveď bola prijatá ako najlepšia")
    );
  });

  // Лайк/дизлайк ответа
  toggleAnswerLike = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    const { default: Like } = await import("../models/Like.js");

    const result = await Like.toggleLike(userId, id, "answer");

    logUserAction(
      userId,
      result.action === "added" ? "ODPOVEĎ_LIKED" : "ODPOVEĎ_UNLIKED",
      `${result.action} like pre odpoveď ${id}`
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
      formatResponse(true, pendingAnswers, "Odpovede na moderácii boli prijaté")
    );
  });

  // Получение статистики ответов (только админы)
  getAnswerStatistics = asyncHandler(async (req, res) => {
    const statistics = await answerService.getAnswerStatistics();

    res.json(
      formatResponse(true, statistics, "Štatistika odpovedí bola získaná")
    );
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
      formatResponse(
        true,
        bestAnswers,
        "Najlepšie odpovede experta boli získané"
      )
    );
  });

  // Массовая модерация ответов (только админы)
  bulkModerateAnswers = asyncHandler(async (req, res) => {
    const { answerIds, isApproved, comment } = req.body;
    const moderatorId = req.user._id;

    if (!Array.isArray(answerIds) || answerIds.length === 0) {
      return res.status(400).json(
        formatResponse(false, null, "Zoznam ID odpovedí je povinný", {
          type: "VALIDATION_ERROR",
          field: "answerIds",
        })
      );
    }

    if (answerIds.length > 50) {
      return res.status(400).json(
        formatResponse(false, null, "Maximálne 50 odpovedí naraz", {
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
      `Moderovaných ${successCount} odpovedí (${errorCount} chýb)`
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
        `Hromadná moderácia dokončená: ${successCount} úspešne, ${errorCount} chýb`
      )
    );
  });
}

export default new AnswerController();
