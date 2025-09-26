// controllers/expertController.js
import userService from "../services/userService.js";
import answerService from "../services/answerService.js";
import questionService from "../services/questionService.js";
import {
  formatResponse,
  getPaginationData,
  isValidObjectId,
} from "../utils/helpers.js";
import { ERROR_MESSAGES } from "../utils/constants.js";
import { asyncHandler } from "../middlewares/errorHandler.js";
import { logUserAction } from "../middlewares/logger.js";

class ExpertController {
  // Получение списка всех экспертов (публичный метод)
  getExperts = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);
    const { sortBy = "rating", sortOrder = -1 } = req.query;

    const options = {
      page,
      limit,
      sortBy,
      sortOrder: parseInt(sortOrder),
    };

    const experts = await userService.getExperts(options);

    res.json(formatResponse(true, experts, "Zoznam expertov bol získaný"));
  });

  // Получение профиля конкретного эксперта (публичный метод)
  getExpertProfile = asyncHandler(async (req, res) => {
    const { expertId } = req.params;

    // Валидация ID
    if (!isValidObjectId(expertId)) {
      return res.status(400).json(
        formatResponse(false, null, "Nesprávny formát ID experta", {
          type: "VALIDATION_ERROR",
          field: "expertId",
        })
      );
    }

    const expert = await userService.getUserById(expertId);

    // Проверяем что пользователь действительно эксперт
    if (!expert.isExpert) {
      return res
        .status(404)
        .json(formatResponse(false, null, "Expert nebol nájdený"));
    }

    // Получаем дополнительную статистику эксперта
    const [expertAnswers, bestAnswers] = await Promise.all([
      answerService.getExpertAnswers(expertId, { page: 1, limit: 5 }),
      answerService.getExpertBestAnswers(expertId, 5),
    ]);

    const expertProfile = {
      ...expert.toObject(),
      recentAnswers: expertAnswers.data,
      bestAnswers,
    };

    res.json(formatResponse(true, expertProfile, "Profil experta bol získaný"));
  });

  // Панель эксперта - общая информация (только для экспертов)
  getDashboard = asyncHandler(async (req, res) => {
    const expertId = req.user._id;

    // Получаем статистику эксперта
    const [pendingQuestions, expertAnswers, bestAnswers, expertInfo] =
      await Promise.all([
        questionService.getPendingQuestions({ page: 1, limit: 10 }),
        answerService.getExpertAnswers(expertId, {
          page: 1,
          limit: 5,
          isApproved: null,
        }),
        answerService.getExpertBestAnswers(expertId, 5),
        userService.getUserById(expertId),
      ]);

    // Подсчитываем статистику ответов эксперта
    const pendingAnswersCount = expertAnswers.data.filter(
      (answer) => !answer.isApproved
    ).length;
    const approvedAnswersCount = expertInfo.totalAnswers;
    const acceptedAnswersCount = expertAnswers.data.filter(
      (answer) => answer.isAccepted
    ).length;

    const dashboardData = {
      expert: {
        id: expertInfo._id,
        email: expertInfo.email,
        avatar: expertInfo.avatar,
        bio: expertInfo.bio,
        rating: expertInfo.rating,
        totalAnswers: expertInfo.totalAnswers,
        totalQuestions: expertInfo.totalQuestions,
      },
      statistics: {
        pendingAnswers: pendingAnswersCount,
        approvedAnswers: approvedAnswersCount,
        acceptedAnswers: acceptedAnswersCount,
        pendingQuestions: pendingQuestions.pagination.totalItems,
      },
      pendingQuestions: pendingQuestions.data,
      recentAnswers: expertAnswers.data,
      bestAnswers,
    };

    res.json(formatResponse(true, dashboardData, "Panel experta bol získaný"));
  });

  // Получение вопросов в ожидании для эксперта
  getPendingQuestions = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);
    const { priority } = req.query;

    const options = {
      page,
      limit,
      priority,
    };

    const questions = await questionService.getPendingQuestions(options);

    res.json(formatResponse(true, questions, "Čakajúce otázky boli získané"));
  });

  // Получение ответов эксперта
  getMyAnswers = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);
    const { isApproved } = req.query;
    const expertId = req.user._id;

    const options = {
      page,
      limit,
      isApproved:
        isApproved === "true" ? true : isApproved === "false" ? false : null,
    };

    const answers = await answerService.getExpertAnswers(expertId, options);

    res.json(formatResponse(true, answers, "Odpovede experta boli získané"));
  });

  // Получение лучших ответов эксперта
  getMyBestAnswers = asyncHandler(async (req, res) => {
    const { limit = 10 } = req.query;
    const expertId = req.user._id;

    const bestAnswers = await answerService.getExpertBestAnswers(
      expertId,
      parseInt(limit)
    );

    res.json(
      formatResponse(true, bestAnswers, "Najlepšie odpovede experta boli získané")
    );
  });

  // Обновление биографии эксперта
  updateExpertBio = asyncHandler(async (req, res) => {
    const { bio } = req.body;
    const expertId = req.user._id;

    // Валидация биографии
    if (bio && bio.length > 500) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Biografia nemôže presiahnuť 500 znakov",
          {
            type: "VALIDATION_ERROR",
            field: "bio",
          }
        )
      );
    }

    const updateData = { bio: bio || null };
    const updatedExpert = await userService.updateProfile(
      expertId,
      updateData,
      req.user
    );

    logUserAction(expertId, "EXPERT_BIO_UPDATED", "Expert aktualizoval svoju biografiu");

    res.json(
      formatResponse(true, updatedExpert, "Biografia experta bola aktualizovaná")
    );
  });

  // Получение статистики эксперта (детальная)
  getExpertStatistics = asyncHandler(async (req, res) => {
    const { expertId } = req.params;
    const requesterId = req.user._id;

    // Валидация ID
    if (!isValidObjectId(expertId)) {
      return res.status(400).json(
        formatResponse(false, null, "Nesprávny formát ID experta", {
          type: "VALIDATION_ERROR",
          field: "expertId",
        })
      );
    }

    // Эксперт может смотреть только свою статистику, админ - любую
    if (expertId !== requesterId.toString() && req.user.role !== "admin") {
      return res
        .status(403)
        .json(formatResponse(false, null, ERROR_MESSAGES.FORBIDDEN));
    }

    const expert = await userService.getUserById(expertId);
    if (!expert.isExpert) {
      return res
        .status(404)
        .json(formatResponse(false, null, "Expert nebol nájdený"));
    }

    // Получаем детальную статистику
    const answerStats = await answerService.getAnswerStatistics();
    const expertAnswers = await answerService.getExpertAnswers(expertId, {
      page: 1,
      limit: 1000,
    });

    const expertSpecificStats = {
      totalAnswers: expert.totalAnswers,
      rating: expert.rating,
      answersBreakdown: {
        approved: expertAnswers.data.filter((a) => a.isApproved).length,
        pending: expertAnswers.data.filter((a) => !a.isApproved).length,
        accepted: expertAnswers.data.filter((a) => a.isAccepted).length,
      },
      totalLikes: expertAnswers.data.reduce(
        (sum, answer) => sum + answer.likes,
        0
      ),
      avgLikesPerAnswer:
        expertAnswers.data.length > 0
          ? (
              expertAnswers.data.reduce(
                (sum, answer) => sum + answer.likes,
                0
              ) / expertAnswers.data.length
            ).toFixed(2)
          : 0,
    };

    res.json(
      formatResponse(true, expertSpecificStats, "Štatistika experta bola získaná")
    );
  });

  // Поиск экспертов по специализации/биографии
  searchExperts = asyncHandler(async (req, res) => {
    const { q: query } = req.query;
    const { page, limit } = getPaginationData(req);

    if (!query || query.trim().length < 2) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Vyhľadávací dopyt musí obsahovať aspoň 2 znaky",
          {
            type: "VALIDATION_ERROR",
            field: "query",
          }
        )
      );
    }

    const options = {
      page,
      limit,
      role: "expert",
    };

    const results = await userService.searchUsers(query.trim(), options);

    // Фильтруем только экспертов (дополнительная проверка)
    const filteredResults = {
      ...results,
      data: results.data.filter((user) => user.isExpert),
    };

    res.json(
      formatResponse(
        true,
        filteredResults,
        "Výsledky vyhľadávania expertov boli získané"
      )
    );
  });

  // Получение активности эксперта (публичная информация)
  getExpertActivity = asyncHandler(async (req, res) => {
    const { expertId } = req.params;
    const { page, limit } = getPaginationData(req);

    // Валидация ID
    if (!isValidObjectId(expertId)) {
      return res.status(400).json(
        formatResponse(false, null, "Nesprávny formát ID experta", {
          type: "VALIDATION_ERROR",
          field: "expertId",
        })
      );
    }

    const expert = await userService.getUserById(expertId);
    if (!expert.isExpert) {
      return res
        .status(404)
        .json(formatResponse(false, null, "Expert nebol nájdený"));
    }

    const options = { page, limit };
    const activity = await userService.getUserActivity(expertId, options);

    // Возвращаем только публичную информацию
    const publicActivity = {
      expert: {
        id: expert._id,
        email: expert.email,
        avatar: expert.avatar,
        bio: expert.bio,
        rating: expert.rating,
        totalAnswers: expert.totalAnswers,
      },
      activity: {
        // Показываем только одобренные ответы в публичной активности
        answers: activity.activity.answers.filter(
          (answer) => answer.isApproved
        ),
        questions: activity.activity.questions, // вопросы показываем все
      },
    };

    res.json(
      formatResponse(true, publicActivity, "Aktivita experta bola získaná")
    );
  });
}

export default new ExpertController();
