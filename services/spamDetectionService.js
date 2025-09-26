// services/spamDetectionService.js
import Question from "../models/Question.js";
import Answer from "../models/Answer.js";
import Comment from "../models/Comment.js";
import User from "../models/User.js";
import { checkSpam } from "../middlewares/spamProtection.js";
import { logSecurityEvent, logError } from "../middlewares/logger.js";

class SpamDetectionService {
  // Анализ существующего контента в БД
  async analyzeExistingContent(contentType = "questions", options = {}) {
    try {
      const { limit = 100, skip = 0, includeProcessed = false } = options;
      let Model;
      let contentField = "content";
      let titleField = null;

      switch (contentType) {
        case "questions":
          Model = Question;
          titleField = "title";
          break;
        case "answers":
          Model = Answer;
          break;
        case "comments":
          Model = Comment;
          break;
        default:
          throw new Error("Neplatný typ obsahu");
      }

      const query = {};
      if (!includeProcessed) {
        // Можно добавить поле spamChecked в модели для отслеживания
        query.spamChecked = { $ne: true };
      }

      const items = await Model.find(query)
        .populate("author", "email role createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const results = [];

      for (const item of items) {
        // Используем middleware функцию для анализа
        const mockReq = {
          body: {
            content: item[contentField],
            title: titleField ? item[titleField] : "",
          },
          user: item.author,
        };

        let spamInfo = null;

        // Создаем middleware и выполняем анализ
        const spamMiddleware = checkSpam({
          threshold: 30,
          checkTitle: !!titleField,
          checkContent: true,
          allowForExperts: true,
          blockHighScore: 80,
        });

        // Эмулируем выполнение middleware
        await new Promise((resolve) => {
          spamMiddleware(mockReq, {}, () => {
            spamInfo = mockReq.spamInfo;
            resolve();
          });
        });

        results.push({
          id: item._id,
          type: contentType.slice(0, -1), // убираем 's' в конце
          content: item[contentField].substring(0, 200) + "...",
          title: titleField ? item[titleField] : null,
          author: item.author,
          createdAt: item.createdAt,
          spamAnalysis: spamInfo,
          needsReview: spamInfo?.isSpam || false,
        });
      }

      return {
        contentType,
        analyzed: results.length,
        suspiciousCount: results.filter((r) => r.needsReview).length,
        results,
      };
    } catch (error) {
      logError(error, "SpamDetectionService.analyzeExistingContent");
      throw error;
    }
  }

  // Анализ поведения пользователя
  async analyzeUserBehavior(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("Používateľ nebol nájdený");
      }

      let suspicionScore = 0;
      const behaviorFlags = [];

      // Возраст аккаунта
      const accountAge = Date.now() - user.createdAt.getTime();
      const daysSinceRegistration = accountAge / (1000 * 60 * 60 * 24);

      if (daysSinceRegistration < 1) {
        suspicionScore += 20;
        behaviorFlags.push("very_new_account");
      } else if (daysSinceRegistration < 7) {
        suspicionScore += 10;
        behaviorFlags.push("new_account");
      }

      // Частота публикаций за последние 24 часа
      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [recentQuestions, recentAnswers, recentComments] =
        await Promise.all([
          Question.countDocuments({
            author: userId,
            createdAt: { $gte: last24Hours },
          }),
          Answer.countDocuments({
            expert: userId,
            createdAt: { $gte: last24Hours },
          }),
          Comment.countDocuments({
            author: userId,
            createdAt: { $gte: last24Hours },
          }),
        ]);

      const totalRecent = recentQuestions + recentAnswers + recentComments;

      if (totalRecent > 20) {
        suspicionScore += 40;
        behaviorFlags.push("excessive_posting");
      } else if (totalRecent > 10) {
        suspicionScore += 20;
        behaviorFlags.push("high_posting_frequency");
      }

      // Соотношение активности
      const totalQuestions = user.totalQuestions || 0;
      const totalAnswers = user.totalAnswers || 0;

      if (totalQuestions > 10 && totalAnswers === 0) {
        suspicionScore += 15;
        behaviorFlags.push("only_questions_no_engagement");
      }

      // Проверяем последние публикации на спам
      const recentContent = await Question.find({
        author: userId,
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }).limit(5);

      let spamContentCount = 0;

      for (const question of recentContent) {
        const mockReq = {
          body: {
            content: question.content,
            title: question.title,
          },
          user: user,
        };

        const spamMiddleware = checkSpam({ threshold: 30 });
        await new Promise((resolve) => {
          spamMiddleware(mockReq, {}, () => {
            if (mockReq.spamInfo?.isSpam) {
              spamContentCount++;
            }
            resolve();
          });
        });
      }

      if (spamContentCount > 2) {
        suspicionScore += 30;
        behaviorFlags.push("multiple_spam_content");
      } else if (spamContentCount > 0) {
        suspicionScore += 15;
        behaviorFlags.push("some_spam_content");
      }

      return {
        userId,
        userEmail: user.email,
        accountAge: Math.round(daysSinceRegistration),
        suspicionScore,
        behaviorFlags,
        recentActivity: {
          questions: recentQuestions,
          answers: recentAnswers,
          comments: recentComments,
          total: totalRecent,
        },
        spamContentDetected: spamContentCount,
        isSuspicious: suspicionScore >= 40,
        riskLevel: this.getRiskLevel(suspicionScore),
      };
    } catch (error) {
      logError(error, "SpamDetectionService.analyzeUserBehavior", userId);
      throw error;
    }
  }

  // Получение статистики спама
  async getSpamStatistics(days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Анализируем недавний контент
      const recentQuestions = await Question.find({
        createdAt: { $gte: startDate },
      })
        .populate("author")
        .limit(1000);

      let totalAnalyzed = 0;
      let spamDetected = 0;
      const spamReasons = {};

      for (const question of recentQuestions) {
        const mockReq = {
          body: {
            content: question.content,
            title: question.title,
          },
          user: question.author,
        };

        const spamMiddleware = checkSpam({ threshold: 30 });
        await new Promise((resolve) => {
          spamMiddleware(mockReq, {}, () => {
            totalAnalyzed++;
            if (mockReq.spamInfo?.isSpam) {
              spamDetected++;
              // Можно анализировать причины спама из mockReq.spamInfo
            }
            resolve();
          });
        });
      }

      // Статистика подозрительных пользователей
      const newUsers = await User.find({
        createdAt: { $gte: startDate },
      }).limit(100);

      let suspiciousUsers = 0;

      for (const user of newUsers) {
        const behavior = await this.analyzeUserBehavior(user._id);
        if (behavior.isSuspicious) {
          suspiciousUsers++;
        }
      }

      return {
        period: `${days} days`,
        content: {
          totalAnalyzed,
          spamDetected,
          spamRate:
            totalAnalyzed > 0
              ? ((spamDetected / totalAnalyzed) * 100).toFixed(2)
              : 0,
        },
        users: {
          newUsers: newUsers.length,
          suspiciousUsers,
          suspiciousRate:
            newUsers.length > 0
              ? ((suspiciousUsers / newUsers.length) * 100).toFixed(2)
              : 0,
        },
        topSpamIndicators: [
          "excessive_links",
          "suspicious_keywords",
          "repeated_patterns",
          "new_user_activity",
        ],
      };
    } catch (error) {
      logError(error, "SpamDetectionService.getSpamStatistics");
      throw error;
    }
  }

  // Массовая проверка пользователей
  async bulkAnalyzeUsers(userIds) {
    try {
      const results = [];

      for (const userId of userIds) {
        try {
          const analysis = await this.analyzeUserBehavior(userId);
          results.push(analysis);
        } catch (error) {
          results.push({
            userId,
            error: error.message,
            isSuspicious: false,
            suspicionScore: 0,
          });
        }
      }

      const suspicious = results.filter((r) => r.isSuspicious);

      return {
        totalAnalyzed: results.length,
        suspiciousFound: suspicious.length,
        suspiciousRate:
          results.length > 0
            ? ((suspicious.length / results.length) * 100).toFixed(2)
            : 0,
        results,
        suspicious,
      };
    } catch (error) {
      logError(error, "SpamDetectionService.bulkAnalyzeUsers");
      throw error;
    }
  }

  // Получение уровня риска
  getRiskLevel(score) {
    if (score >= 80) return "critical";
    if (score >= 60) return "high";
    if (score >= 40) return "medium";
    if (score >= 20) return "low";
    return "minimal";
  }

  // Отметка контента как проверенного
  async markContentAsChecked(contentType, contentId, isSpam = false) {
    try {
      let Model;

      switch (contentType) {
        case "question":
          Model = Question;
          break;
        case "answer":
          Model = Answer;
          break;
        case "comment":
          Model = Comment;
          break;
        default:
          throw new Error("Neplatný typ obsahu");
      }

      await Model.findByIdAndUpdate(contentId, {
        spamChecked: true,
        spamFlag: isSpam,
        spamCheckedAt: new Date(),
      });

      if (isSpam) {
        logSecurityEvent(
          "CONTENT_MARKED_AS_SPAM",
          `${contentType} ${contentId} označený ako spam administrátorom`,
          null,
          null
        );
      }

      return true;
    } catch (error) {
      logError(error, "SpamDetectionService.markContentAsChecked");
      throw error;
    }
  }

  // Получение контента требующего проверки
  async getContentNeedingReview(limit = 50) {
    try {
      const results = await this.analyzeExistingContent("questions", {
        limit,
        includeProcessed: false,
      });

      return results.results.filter((item) => item.needsReview);
    } catch (error) {
      logError(error, "SpamDetectionService.getContentNeedingReview");
      throw error;
    }
  }
}

export default new SpamDetectionService();
