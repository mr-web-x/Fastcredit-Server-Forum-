// controllers/adminController.js
import answerService from "../services/answerService.js";
import questionService from "../services/questionService.js";
import commentService from "../services/commentService.js";
import userService from "../services/userService.js";
import roleService from "../services/roleService.js";
import spamDetectionService from "../services/spamDetectionService.js";
import rateLimitService from "../services/rateLimitService.js";
import {
  formatResponse,
  getPaginationData,
  isValidObjectId,
} from "../utils/helpers.js";
import { QUESTION_STATUS } from "../utils/constants.js";
import { asyncHandler } from "../middlewares/errorHandler.js";
import { logUserAction } from "../middlewares/logger.js";

class AdminController {
  // Главная страница админки - общая статистика
  getDashboard = asyncHandler(async (req, res) => {
    const [
      questionStats,
      answerStats,
      commentStats,
      userStats,
      roleStats,
      rateLimitStats,
    ] = await Promise.all([
      questionService.getQuestionStatistics(),
      answerService.getAnswerStatistics(),
      commentService.getCommentStatistics(),
      userService.getUserStatistics(),
      roleService.getRoleStatistics(),
      rateLimitService.getRateLimitStatistics(24),
    ]);

    const dashboardData = {
      overview: {
        totalUsers: userStats.total,
        activeUsers: userStats.active,
        totalQuestions: questionStats.total,
        pendingQuestions: questionStats.unanswered,
        totalAnswers: answerStats.total,
        pendingAnswers: answerStats.pending,
        totalComments: commentStats.total,
      },
      users: {
        total: userStats.total,
        active: userStats.active,
        experts: userStats.experts,
        admins: userStats.admins,
        banned: userStats.banned,
        recentRegistrations: userStats.recentRegistrations,
      },
      content: {
        questions: {
          total: questionStats.total,
          pending: questionStats.unanswered,
          answered: questionStats.total - questionStats.unanswered,
          withAcceptedAnswers: questionStats.withAcceptedAnswers,
        },
        answers: {
          total: answerStats.total,
          approved: answerStats.approved,
          pending: answerStats.pending,
          accepted: answerStats.accepted,
        },
        comments: {
          total: commentStats.total,
          approved: commentStats.approved,
          pending: commentStats.pending,
        },
      },
      roles: {
        recentChanges: roleStats.recentChanges,
        topAdmins: roleStats.topAdmins,
      },
      security: {
        rateLimitViolations: rateLimitStats.summary.totalBlocked,
        activeRateLimits: rateLimitStats.summary.totalRequests,
      },
    };

    res.json(formatResponse(true, dashboardData, "Bol prijatý panel správcu"));
  });

  // Модерация вопросов
  getQuestionsModerationQueue = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);
    const { status, priority } = req.query;

    const options = {
      page,
      limit,
      status: status || null,
      priority: priority || null,
      sortBy: "createdAt",
      sortOrder: -1,
    };

    const questions = await questionService.getQuestions(options);

    res.json(
      formatResponse(
        true,
        questions,
        "Bol dosiahnutý front na moderovanie otázok"
      )
    );
  });

  // Модерация ответов - получение списка на модерации
  getAnswersModerationQueue = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);

    const options = { page, limit };
    const pendingAnswers = await answerService.getPendingAnswers(options);

    res.json(
      formatResponse(
        true,
        pendingAnswers,
        "Bol dosiahnutý front na moderovanie otázok"
      )
    );
  });

  // Модерация комментариев - получение списка на модерации
  getCommentsModerationQueue = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);

    const options = { page, limit };
    const pendingComments = await commentService.getPendingComments(options);

    res.json(
      formatResponse(
        true,
        pendingComments,
        "Bol dosiahnutý front na moderovanie otázok"
      )
    );
  });

  // Изменение статуса вопроса
  moderateQuestion = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const adminId = req.user._id;

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Neplatný formát ID otázky", {
          type: "VALIDATION_ERROR",
          field: "id",
        })
      );
    }

    // Валидация статуса
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
      adminId
    );

    res.json(
      formatResponse(
        true,
        updatedQuestion,
        `Stav otázky bol zmenený na "${status}"`
      )
    );
  });

  // Управление пользователями - получение списка
  getUsers = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);
    const {
      role,
      isActive,
      isBanned,
      search,
      sortBy = "createdAt",
      sortOrder = -1,
    } = req.query;

    const options = {
      page,
      limit,
      role,
      isActive:
        isActive === "true" ? true : isActive === "false" ? false : null,
      isBanned:
        isBanned === "true" ? true : isBanned === "false" ? false : null,
      search,
      sortBy,
      sortOrder: parseInt(sortOrder),
    };

    const users = await userService.getUsers(options);

    res.json(formatResponse(true, users, "Bol prijatý zoznam používateľov"));
  });

  // Статистика форума
  getForumStatistics = asyncHandler(async (req, res) => {
    const { period = 30 } = req.query; // период в днях

    const [
      questionStats,
      answerStats,
      commentStats,
      userStats,
      roleStats,
      spamStats,
    ] = await Promise.all([
      questionService.getQuestionStatistics(),
      answerService.getAnswerStatistics(),
      commentService.getCommentStatistics(),
      userService.getUserStatistics(),
      roleService.getRoleStatistics(),
      spamDetectionService.getSpamStatistics(parseInt(period)),
    ]);

    const forumStatistics = {
      period: `${period} days`,
      summary: {
        totalUsers: userStats.total,
        totalQuestions: questionStats.total,
        totalAnswers: answerStats.total,
        totalComments: commentStats.total,
        answerRate: questionStats.answerRate,
        acceptanceRate: questionStats.acceptanceRate,
      },
      content: {
        questions: questionStats,
        answers: answerStats,
        comments: commentStats,
      },
      users: userStats,
      roles: roleStats,
      security: {
        spam: spamStats,
        contentModeration: {
          questionsModerated: 0, // можно добавить в questionService
          answersModerated: answerStats.total - answerStats.pending,
          commentsModerated: commentStats.total - commentStats.pending,
        },
      },
    };

    res.json(formatResponse(true, forumStatistics, "Prijaté štatistiky fóra"));
  });

  // История изменений ролей
  getRoleChangesHistory = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);
    const { role, changedBy } = req.query;

    // Валидация changedBy если передан
    if (changedBy && !isValidObjectId(changedBy)) {
      return res.status(400).json(
        formatResponse(false, null, "Neplatný formát ID správcu", {
          type: "VALIDATION_ERROR",
          field: "changedBy",
        })
      );
    }

    const options = {
      page,
      limit,
      role: role || null,
      changedBy: changedBy || null,
    };

    const roleChanges = await roleService.getAllRoleChanges(options);

    res.json(
      formatResponse(true, roleChanges, "Bola prijatá história zmien rolí")
    );
  });

  // Анализ подозрительной активности
  analyzeSpamContent = asyncHandler(async (req, res) => {
    const { contentType = "questions", limit = 100 } = req.query;

    if (!["questions", "answers", "comments"].includes(contentType)) {
      return res.status(400).json(
        formatResponse(false, null, "Neplatný typ obsahu", {
          type: "VALIDATION_ERROR",
          field: "contentType",
          allowedValues: ["questions", "answers", "comments"],
        })
      );
    }

    const options = {
      limit: parseInt(limit),
      includeProcessed: false,
    };

    const analysis = await spamDetectionService.analyzeExistingContent(
      contentType,
      options
    );

    res.json(
      formatResponse(true, analysis, "Analýza spamového obsahu bola dokončená")
    );
  });

  // Анализ поведения пользователя
  analyzeUserBehavior = asyncHandler(async (req, res) => {
    const { userId } = req.params;

    // Валидация ID
    if (!isValidObjectId(userId)) {
      return res.status(400).json(
        formatResponse(false, null, "Neplatný formát ID používateľa", {
          type: "VALIDATION_ERROR",
          field: "userId",
        })
      );
    }

    const analysis = await spamDetectionService.analyzeUserBehavior(userId);

    res.json(
      formatResponse(
        true,
        analysis,
        "Analýza správania používateľov je dokončená"
      )
    );
  });

  // Rate limiting статистика
  getRateLimitStatistics = asyncHandler(async (req, res) => {
    const { hours = 24 } = req.query;

    const statistics = await rateLimitService.getRateLimitStatistics(
      parseInt(hours)
    );

    res.json(
      formatResponse(
        true,
        statistics,
        "Boli prijaté štatistiky obmedzujúce rýchlosť"
      )
    );
  });

  // Пользователи с превышением лимитов
  getUsersExceedingLimits = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);
    const { action, timeWindow = 3600000 } = req.query; // 1 час по умолчанию

    const options = {
      page,
      limit,
      action: action || null,
      timeWindow: parseInt(timeWindow),
    };

    const violators = await rateLimitService.getUsersExceedingLimits(options);

    res.json(
      formatResponse(true, violators, "Porušovatelia limitu rýchlosti prijatí")
    );
  });

  // Сброс rate limit для пользователя
  resetUserRateLimits = asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { action } = req.body; // опционально - конкретное действие
    const adminId = req.user._id;

    // Валидация ID
    if (!isValidObjectId(userId)) {
      return res.status(400).json(
        formatResponse(false, null, "Neplatný formát ID používateľa", {
          type: "VALIDATION_ERROR",
          field: "userId",
        })
      );
    }

    const result = await rateLimitService.resetUserLimits(
      userId,
      adminId,
      action
    );

    res.json(
      formatResponse(true, result, "Limity počtu používateľov boli resetované.")
    );
  });

  // Массовая модерация контента
  bulkModerateContent = asyncHandler(async (req, res) => {
    const { contentType, itemIds, action, comment } = req.body;
    const moderatorId = req.user._id;

    // Валидация типа контента
    if (!contentType || !["answer", "comment"].includes(contentType)) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Podporovaná je iba moderácia odpovedí a komentárov.",
          {
            type: "VALIDATION_ERROR",
            field: "contentType",
            allowedValues: ["answer", "comment"],
          }
        )
      );
    }

    // Валидация списка ID
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json(
        formatResponse(false, null, "Zoznam ID prvkov je povinný.", {
          type: "VALIDATION_ERROR",
          field: "itemIds",
        })
      );
    }

    if (itemIds.length > 50) {
      return res.status(400).json(
        formatResponse(false, null, "Maximálne 50 položiek naraz", {
          type: "VALIDATION_ERROR",
          field: "itemIds",
        })
      );
    }

    // Валидация каждого ID
    for (const itemId of itemIds) {
      if (!isValidObjectId(itemId)) {
        return res.status(400).json(
          formatResponse(false, null, `Neplatný formát ID: ${itemId}`, {
            type: "VALIDATION_ERROR",
            field: "itemIds",
          })
        );
      }
    }

    // Валидация действия
    if (!action || !["approve", "reject"].includes(action)) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Akcia musí byť schválená alebo zamietnutá.",
          {
            type: "VALIDATION_ERROR",
            field: "action",
            allowedValues: ["approve", "reject"],
          }
        )
      );
    }

    const isApproved = action === "approve";
    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (const itemId of itemIds) {
      try {
        if (contentType === "answer") {
          await answerService.moderateAnswer(
            itemId,
            isApproved,
            moderatorId,
            comment
          );
        } else if (contentType === "comment") {
          await commentService.moderateComment(itemId, isApproved, moderatorId);
        }
        results.push({ itemId, success: true });
        successCount++;
      } catch (error) {
        results.push({ itemId, success: false, error: error.message });
        errorCount++;
      }
    }

    logUserAction(
      moderatorId,
      "BULK_CONTENT_MODERATION",
      `Bulk moderated ${contentType}s: ${successCount} success, ${errorCount} errors`
    );

    res.json(
      formatResponse(
        true,
        {
          results,
          summary: {
            total: itemIds.length,
            success: successCount,
            errors: errorCount,
          },
        },
        `Hromadná moderácia dokončená: ${successCount} úspešných, ${errorCount} chýb`
      )
    );
  });

  // Получение переходов ролей
  getRoleTransitions = asyncHandler(async (req, res) => {
    const transitions = await roleService.getRoleTransitions();

    res.json(formatResponse(true, transitions, "Boli prijaté prechody rolí"));
  });
}

export default new AdminController();
