// controllers/questionController.js
import questionService from "../services/questionService.js";
import slugService from "../services/slugService.js";
import notificationService from "../services/notificationService.js";
import { formatResponse, getPaginationData } from "../utils/helpers.js";
import {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  QUESTION_STATUS,
} from "../utils/constants.js";
import { asyncHandler } from "../middlewares/errorHandler.js";
import { logUserAction } from "../middlewares/logger.js";

class QuestionController {
  // Получение всех вопросов с фильтрами и пагинацией
  getQuestions = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);
    const {
      status,
      category,
      priority,
      author,
      hasAnswer,
      hasApprovedAnswers,
      hasPendingAnswers,
      includeAnswersCounters,
      sortBy = "createdAt",
      sortOrder = -1,
      search,
    } = req.query;

    const options = {
      page,
      limit,
      status,
      category,
      priority,
      author,
      hasAnswer:
        hasAnswer === "true" ? true : hasAnswer === "false" ? false : null,
      hasApprovedAnswers:
        hasApprovedAnswers === "true"
          ? true
          : hasApprovedAnswers === "false"
          ? false
          : null,
      hasPendingAnswers:
        hasPendingAnswers === "true"
          ? true
          : hasPendingAnswers === "false"
          ? false
          : null,
      includeAnswersCounters: includeAnswersCounters === "true",
      sortBy,
      sortOrder: parseInt(sortOrder),
      search,
    };

    const questions = await questionService.getQuestions(options);

    res.json(formatResponse(true, questions, "Zoznam otázok bol získaný"));
  });

  // Получение вопросов в ожидании ответа (для экспертов)
  getPendingQuestions = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);
    const { priority } = req.query;

    const options = {
      page,
      limit,
      priority,
    };

    const questions = await questionService.getPendingQuestions(options);

    res.json(formatResponse(true, questions, "Otázky čakajúce na odpoveď boli získané"));
  });

  // Получение конкретного вопроса по slug
  getQuestionBySlug = asyncHandler(async (req, res) => {
    const { slug } = req.params;
    const viewerId = req.user?._id || null;

    const question = await questionService.getQuestionBySlug(slug, viewerId);

    if (!question) {
      return res
        .status(404)
        .json(formatResponse(false, null, ERROR_MESSAGES.QUESTION_NOT_FOUND));
    }

    res.json(formatResponse(true, question, "Otázka bola nájdená"));
  });

  // Создание нового вопроса
  createQuestion = asyncHandler(async (req, res) => {
    const { title, content, category, priority } = req.body;
    const authorId = req.user._id;

    // Дополнительная валидация
    if (!title || title.trim().length < 10) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Nadpis musí obsahovať minimálne 10 znakov",
          {
            type: "VALIDATION_ERROR",
            field: "title",
          }
        )
      );
    }

    if (!content || content.trim().length < 20) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Obsah musí obsahovať minimálne 20 znakov",
          {
            type: "VALIDATION_ERROR",
            field: "content",
          }
        )
      );
    }

    const questionData = {
      title: title.trim(),
      content: content.trim(),
      category: category || "general",
      priority: priority || "medium",
    };

    const question = await questionService.createQuestion(
      questionData,
      authorId
    );

    // Уведомляем экспертов о новом вопросе
    try {
      await notificationService.notifyExpertsAboutNewQuestion(question._id);
    } catch (notificationError) {
      // Ошибки уведомлений не должны влиять на создание вопроса
      console.warn("Failed to notify experts:", notificationError.message);
    }

    res
      .status(201)
      .json(formatResponse(true, question, SUCCESS_MESSAGES.QUESTION_CREATED));
  });

  // Обновление вопроса
  updateQuestion = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { title, content, category, priority } = req.body;
    const userId = req.user._id;

    const updateData = {};
    if (title !== undefined) updateData.title = title.trim();
    if (content !== undefined) updateData.content = content.trim();
    if (category !== undefined) updateData.category = category;
    if (priority !== undefined) updateData.priority = priority;

    if (Object.keys(updateData).length === 0) {
      return res
        .status(400)
        .json(formatResponse(false, null, "Žiadne údaje na aktualizáciu"));
    }

    const updatedQuestion = await questionService.updateQuestion(
      id,
      updateData,
      userId
    );

    res.json(formatResponse(true, updatedQuestion, "Otázka bola úspešne aktualizovaná"));
  });

  // Удаление вопроса
  deleteQuestion = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    await questionService.deleteQuestion(id, userId);

    res.json(formatResponse(true, null, "Otázka bola úspešne odstránená"));
  });

  // Поиск вопросов
  searchQuestions = asyncHandler(async (req, res) => {
    const { q: query } = req.query;
    const { page, limit } = getPaginationData(req);

    if (!query || query.trim().length < 2) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Vyhľadávací dopyt musí obsahovať minimálne 2 znaky",
          {
            type: "VALIDATION_ERROR",
            field: "query",
          }
        )
      );
    }

    const options = { page, limit };
    const results = await questionService.searchQuestions(
      query.trim(),
      options
    );

    res.json(formatResponse(true, results, "Výsledky vyhľadávania boli získané"));
  });

  // Лайк/дизлайк вопроса
  toggleQuestionLike = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    // Используем правильный сервис
    const result = await questionService.toggleQuestionLike(id, userId);

    logUserAction(
      userId,
      result.action === "added" ? "QUESTION_LIKED" : "QUESTION_UNLIKED",
      `${result.action} like for question ${id}`
    );

    res.json(
      formatResponse(
        true,
        {
          liked: result.liked,
          action: result.action,
          likesCount: result.likesCount,
        },
        result.action === "added"
          ? SUCCESS_MESSAGES.LIKE_ADDED
          : SUCCESS_MESSAGES.LIKE_REMOVED
      )
    );
  });

  // Получение похожих вопросов
  getSimilarQuestions = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { limit = 5 } = req.query;

    const similarQuestions = await questionService.getSimilarQuestions(
      id,
      parseInt(limit)
    );

    res.json(formatResponse(true, similarQuestions, "Podobné otázky boli nájdené"));
  });

  // Изменение статуса вопроса (только админы)
  changeQuestionStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user._id;

    if (!Object.values(QUESTION_STATUS).includes(status)) {
      return res.status(400).json(
        formatResponse(false, null, "Neplatný stav otázky", {
          type: "VALIDATION_ERROR",
          field: "status",
          allowedValues: Object.values(QUESTION_STATUS),
        })
      );
    }

    const updatedQuestion = await questionService.changeQuestionStatus(
      id,
      status,
      userId
    );

    res.json(formatResponse(true, updatedQuestion, "Stav otázky bol zmenený"));
  });

  // Получение статистики вопросов (только админы)
  getQuestionStatistics = asyncHandler(async (req, res) => {
    const statistics = await questionService.getQuestionStatistics();

    res.json(formatResponse(true, statistics, "Štatistika otázok bola získaná"));
  });

  // Получение вопросов пользователя
  getUserQuestions = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { page, limit } = getPaginationData(req);

    // Проверяем права: пользователь может смотреть только свои вопросы, админ - любые
    if (userId !== req.user._id.toString() && req.user.role !== "admin") {
      return res
        .status(403)
        .json(formatResponse(false, null, ERROR_MESSAGES.FORBIDDEN));
    }

    const options = {
      page,
      limit,
      status: req.query.status || null,
    };

    // Используем правильный метод сервиса
    const questions = await questionService.getUserQuestions(userId, options);

    res.json(formatResponse(true, questions, "Otázky používateľa boli získané"));
  });

  // Валидация slug вопроса
  validateQuestionSlug = asyncHandler(async (req, res) => {
    const { slug } = req.params;

    const validation = slugService.validateSlug(slug);
    const exists = await slugService.isQuestionSlugExists(slug);

    res.json(
      formatResponse(
        true,
        {
          slug,
          isValid: validation.isValid,
          exists,
          error: validation.error || null,
          available: validation.isValid && !exists,
        },
        "Validácia slug bola vykonaná"
      )
    );
  });

  // Получение топ вопросов (новый метод)
  getTopQuestions = asyncHandler(async (req, res) => {
    const { limit = 10, period = 30, sortBy = "likes" } = req.query;

    const options = {
      limit: parseInt(limit),
      period: parseInt(period),
      sortBy,
    };

    const topQuestions = await questionService.getTopQuestions(options);

    res.json(formatResponse(true, topQuestions, "Top otázky boli získané"));
  });
}

export default new QuestionController();
