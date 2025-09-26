// services/questionService.js
import Question from "../models/Question.js";
import User from "../models/User.js";
import Answer from "../models/Answer.js";
import Comment from "../models/Comment.js";
import Like from "../models/Like.js";
import { QUESTION_STATUS, QUESTION_PRIORITY } from "../utils/constants.js";
import { logUserAction, logError } from "../middlewares/logger.js";
import {
  generateUniqueSlug,
  createPaginationResponse,
} from "../utils/helpers.js";
import cryptoService from "./cryptoService.js";

class QuestionService {
  // Создание нового вопроса
  async createQuestion(questionData, authorId) {
    try {
      const {
        title,
        content,
        category = "general",
        priority = QUESTION_PRIORITY.MEDIUM,
      } = questionData;

      // Генерируем уникальный slug
      const slug = await generateUniqueSlug(title, Question);

      // Создаем вопрос
      const question = new Question({
        title,
        content,
        slug,
        category,
        priority,
        author: authorId,
        status: QUESTION_STATUS.PENDING,
      });

      await question.save();

      // Увеличиваем счетчик вопросов у пользователя
      await User.findByIdAndUpdate(authorId, { $inc: { totalQuestions: 1 } });

      // Загружаем вопрос с автором
      const populatedQuestion = await Question.findById(question._id).populate(
        "author",
        "firstName lastName email role avatar"
      );

      await cryptoService.smartDecrypt(populatedQuestion);

      logUserAction(
        authorId,
        "QUESTION_CREATED",
        `Created question: ${title} (${slug})`
      );

      return populatedQuestion;
    } catch (error) {
      logError(error, "QuestionService.createQuestion", authorId);
      throw error;
    }
  }

  // Получение вопроса по slug
  async getQuestionBySlug(slug, viewerId = null) {
    try {
      const question = await Question.findOne({ slug }).populate(
        "author",
        "firstName lastName email role avatar bio rating"
      );

      if (!question) {
        throw new Error("Question not found");
      }

      await cryptoService.smartDecrypt(question);

      // Увеличиваем просмотры (но не для автора)
      if (!viewerId || viewerId.toString() !== question.author._id.toString()) {
        await question.incrementViews();
      }

      return question;
    } catch (error) {
      logError(error, "QuestionService.getQuestionBySlug");
      throw error;
    }
  }

  // Получение списка вопросов с фильтрами
  async getQuestions(options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        status = null,
        category = null,
        priority = null,
        author = null,
        hasAnswer = null,
        hasApprovedAnswers = null,
        hasPendingAnswers = null,
        includeAnswersCounters = false, // Новый параметр для админ-панели
        sortBy = "createdAt",
        sortOrder = -1,
        search = null,
      } = options;

      const skip = (page - 1) * limit;

      // Используем aggregation если нужны фильтры по ответам ИЛИ счетчики для админов
      if (
        hasApprovedAnswers !== null ||
        hasPendingAnswers !== null ||
        includeAnswersCounters
      ) {
        return await this.getQuestionsWithAnswersAggregation(options);
      }

      // Обычный запрос без фильтров по ответам (для публичной страницы)
      const query = {};

      // Фильтры
      if (status) query.status = status;
      if (category) query.category = category;
      if (priority) query.priority = priority;
      if (author) query.author = author;
      if (hasAnswer !== null) query.hasAcceptedAnswer = hasAnswer;

      // Поиск по заголовку и контенту
      if (search) {
        query.$text = { $search: search };
      }

      const [questions, total] = await Promise.all([
        Question.find(query)
          .populate("author", "firstName lastName email role avatar")
          .sort(
            search ? { score: { $meta: "textScore" } } : { [sortBy]: sortOrder }
          )
          .skip(skip)
          .limit(limit),
        Question.countDocuments(query),
      ]);

      await cryptoService.smartDecrypt(questions);

      return createPaginationResponse(questions, total, page, limit);
    } catch (error) {
      logError(error, "QuestionService.getQuestions");
      throw error;
    }
  }

  // Метод с aggregation для фильтров по ответам и счетчиков
  async getQuestionsWithAnswersAggregation(options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        status = null,
        category = null,
        priority = null,
        author = null,
        hasAnswer = null,
        hasApprovedAnswers = null,
        hasPendingAnswers = null,
        sortBy = "createdAt",
        sortOrder = -1,
        search = null,
      } = options;

      const skip = (page - 1) * limit;

      // Базовый pipeline
      const pipeline = [
        // Lookup к таблице ответов
        {
          $lookup: {
            from: "answers",
            localField: "_id",
            foreignField: "questionId",
            as: "answers",
          },
        },

        // Добавляем подсчетные поля и упрощенные ответы
        {
          $addFields: {
            approvedAnswersCount: {
              $size: {
                $filter: {
                  input: "$answers",
                  cond: { $eq: ["$$this.isApproved", true] },
                },
              },
            },
            pendingAnswersCount: {
              $size: {
                $filter: {
                  input: "$answers",
                  cond: { $eq: ["$$this.isApproved", false] },
                },
              },
            },
            // Упрощенный массив ответов только с нужными полями
            userAnswers: {
              $map: {
                input: "$answers",
                as: "answer",
                in: {
                  _id: "$$answer._id",
                  expert: "$$answer.expert",
                  isApproved: "$$answer.isApproved",
                  isAccepted: "$$answer.isAccepted",
                },
              },
            },
          },
        },

        // Удаляем полный массив answers для экономии трафика
        { $unset: "answers" },
      ];

      // Строим фильтры
      const matchQuery = {};

      if (status) matchQuery.status = status;
      if (category) matchQuery.category = category;
      if (priority) matchQuery.priority = priority;
      if (author) matchQuery.author = author;
      if (hasAnswer !== null) matchQuery.hasAcceptedAnswer = hasAnswer;

      // Фильтры по ответам
      if (hasApprovedAnswers === true) {
        matchQuery.approvedAnswersCount = { $gt: 0 };
      } else if (hasApprovedAnswers === false) {
        matchQuery.approvedAnswersCount = 0;
      }

      if (hasPendingAnswers === true) {
        matchQuery.pendingAnswersCount = { $gt: 0 };
      } else if (hasPendingAnswers === false) {
        matchQuery.pendingAnswersCount = 0;
      }

      // Поиск по тексту
      if (search) {
        matchQuery.$text = { $search: search };
      }

      // Добавляем фильтры в pipeline
      if (Object.keys(matchQuery).length > 0) {
        pipeline.push({ $match: matchQuery });
      }

      // Populate автора
      pipeline.push({
        $lookup: {
          from: "users",
          localField: "author",
          foreignField: "_id",
          as: "author",
          pipeline: [
            {
              $project: {
                firstName: 1,
                lastName: 1,
                email: 1,
                role: 1,
                avatar: 1,
              },
            },
          ],
        },
      });

      // Разворачиваем автора
      pipeline.push({ $unwind: "$author" });

      // Сортировка
      if (search) {
        pipeline.push({ $sort: { score: { $meta: "textScore" } } });
      } else {
        pipeline.push({ $sort: { [sortBy]: sortOrder } });
      }

      // Для подсчета общего количества создаем отдельный pipeline
      const countPipeline = [...pipeline];
      countPipeline.push({ $count: "total" });

      // Добавляем пагинацию
      pipeline.push({ $skip: skip });
      pipeline.push({ $limit: limit });

      const [questionsResult, countResult] = await Promise.all([
        Question.aggregate(pipeline),
        Question.aggregate(countPipeline),
      ]);

      const total = countResult[0]?.total || 0;
      const questions = questionsResult;

      await cryptoService.smartDecrypt(questions);

      return createPaginationResponse(questions, total, page, limit);
    } catch (error) {
      logError(error, "QuestionService.getQuestionsWithAnswersAggregation");
      throw error;
    }
  }
  // Получение вопросов в ожидании ответа
  async getPendingQuestions(options = {}) {
    try {
      const { page = 1, limit = 20, priority = null } = options;
      const skip = (page - 1) * limit;

      const query = { status: QUESTION_STATUS.PENDING };
      if (priority) query.priority = priority;

      const [questions, total] = await Promise.all([
        Question.find(query)
          .populate("author", "firstName lastName email role avatar")
          .sort({ priority: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Question.countDocuments(query),
      ]);

      await cryptoService.smartDecrypt(questions);

      return createPaginationResponse(questions, total, page, limit);
    } catch (error) {
      logError(error, "QuestionService.getPendingQuestions");
      throw error;
    }
  }

  // Обновление вопроса
  async updateQuestion(questionId, updateData, userId) {
    try {
      const question = await Question.findById(questionId);

      if (!question) {
        throw new Error("Question not found");
      }

      // Проверяем права (автор или админ)
      const user = await User.findById(userId);
      const canEdit =
        question.author.toString() === userId.toString() ||
        user.role === "admin";

      if (!canEdit) {
        throw new Error("No permission to edit this question");
      }

      // Обновляем вопрос
      Object.keys(updateData).forEach((key) => {
        if (updateData[key] !== undefined) {
          question[key] = updateData[key];
        }
      });

      await question.save();

      logUserAction(
        userId,
        "QUESTION_UPDATED",
        `Updated question: ${question.slug}`
      );

      const resultQuestion = await Question.findById(questionId).populate(
        "author",
        "firstName lastName originalEmail role avatar"
      );

      await cryptoService.smartDecrypt(resultQuestion);

      return resultQuestion;
    } catch (error) {
      logError(error, "QuestionService.updateQuestion", userId);
      throw error;
    }
  }

  // Удаление вопроса
  async deleteQuestion(questionId, userId) {
    try {
      const question = await Question.findById(questionId);

      if (!question) {
        throw new Error("Question not found");
      }

      // Проверяем права (автор или админ)
      const user = await User.findById(userId);
      const canDelete =
        question.author.toString() === userId.toString() ||
        user.role === "admin";

      if (!canDelete) {
        throw new Error("No permission to delete this question");
      }

      // Удаляем связанные данные
      await Promise.all([
        Answer.deleteMany({ questionId }),
        Comment.deleteMany({ questionId }),
        Like.deleteMany({ targetId: questionId, targetType: "question" }),
      ]);

      // Уменьшаем счетчик вопросов у автора
      await User.findByIdAndUpdate(question.author, {
        $inc: { totalQuestions: -1 },
      });

      // Удаляем сам вопрос
      await Question.findByIdAndDelete(questionId);

      logUserAction(
        userId,
        "QUESTION_DELETED",
        `Deleted question: ${question.slug}`
      );

      return { success: true };
    } catch (error) {
      logError(error, "QuestionService.deleteQuestion", userId);
      throw error;
    }
  }

  // Поиск вопросов
  async searchQuestions(searchQuery, options = {}) {
    try {
      const { page = 1, limit = 20 } = options;
      const skip = (page - 1) * limit;

      if (!searchQuery || searchQuery.trim().length < 2) {
        throw new Error("Search query must be at least 2 characters long");
      }

      const query = {
        $or: [
          { title: { $regex: searchQuery, $options: "i" } },
          { content: { $regex: searchQuery, $options: "i" } },
          { $text: { $search: searchQuery } },
        ],
      };

      const [questions, total] = await Promise.all([
        Question.find(query)
          .populate("author", "firstName lastName email role avatar")
          .sort({ score: { $meta: "textScore" } })
          .skip(skip)
          .limit(limit),
        Question.countDocuments(query),
      ]);

      return createPaginationResponse(questions, total, page, limit);
    } catch (error) {
      logError(error, "QuestionService.searchQuestions");
      throw error;
    }
  }

  // Лайк/дизлайк вопроса
  async toggleQuestionLike(questionId, userId) {
    try {
      const question = await Question.findById(questionId);
      if (!question) {
        throw new Error("Question not found");
      }

      // Проверяем существующий лайк
      const existingLike = await Like.findOne({
        userId,
        targetId: questionId,
        targetType: "question",
      });

      if (existingLike) {
        // Убираем лайк
        await Like.findByIdAndDelete(existingLike._id);
        await question.decrementLikes();

        return {
          liked: false,
          action: "removed",
          likesCount: question.likes,
        };
      } else {
        // Добавляем лайк
        await Like.create({
          userId,
          targetId: questionId,
          targetType: "question",
        });
        await question.incrementLikes();

        return {
          liked: true,
          action: "added",
          likesCount: question.likes,
        };
      }
    } catch (error) {
      logError(error, "QuestionService.toggleQuestionLike", userId);
      throw error;
    }
  }

  // Получение похожих вопросов
  async getSimilarQuestions(questionId, limit = 5) {
    try {
      const question = await Question.findById(questionId);
      if (!question) {
        throw new Error("Question not found");
      }

      // Поиск по категории и ключевым словам из заголовка
      const titleWords = question.title
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => word.length > 3);

      const query = {
        _id: { $ne: questionId },
        $or: [
          { category: question.category },
          {
            title: {
              $regex: titleWords.join("|"),
              $options: "i",
            },
          },
        ],
      };

      const similarQuestions = await Question.find(query)
        .populate("author", "firstName lastName email role avatar")
        .sort({ likes: -1, views: -1 })
        .limit(limit);

      return similarQuestions;
    } catch (error) {
      logError(error, "QuestionService.getSimilarQuestions");
      throw error;
    }
  }

  // Изменение статуса вопроса (только админы)
  async changeQuestionStatus(questionId, newStatus, userId) {
    try {
      const question = await Question.findById(questionId);
      if (!question) {
        throw new Error("Question not found");
      }

      const oldStatus = question.status;
      question.status = newStatus;

      if (newStatus === QUESTION_STATUS.ANSWERED) {
        question.answeredAt = new Date();
      }

      await question.save();

      logUserAction(
        userId,
        "QUESTION_STATUS_CHANGED",
        `Changed status of question ${question.slug}: ${oldStatus} → ${newStatus}`
      );

      return await Question.findById(questionId).populate(
        "author",
        "firstName lastName email role avatar"
      );
    } catch (error) {
      logError(error, "QuestionService.changeQuestionStatus", userId);
      throw error;
    }
  }

  // Получение статистики вопросов
  async getQuestionStatistics() {
    try {
      const [
        total,
        pending,
        answered,
        closed,
        withAcceptedAnswer,
        totalViews,
        totalLikes,
      ] = await Promise.all([
        Question.countDocuments(),
        Question.countDocuments({ status: QUESTION_STATUS.PENDING }),
        Question.countDocuments({ status: QUESTION_STATUS.ANSWERED }),
        Question.countDocuments({ status: QUESTION_STATUS.CLOSED }),
        Question.countDocuments({ hasAcceptedAnswer: true }),
        Question.aggregate([
          { $group: { _id: null, total: { $sum: "$views" } } },
        ]),
        Question.aggregate([
          { $group: { _id: null, total: { $sum: "$likes" } } },
        ]),
      ]);

      const unanswered = pending;
      const answerRate = total > 0 ? ((answered / total) * 100).toFixed(2) : 0;
      const acceptanceRate =
        answered > 0 ? ((withAcceptedAnswer / answered) * 100).toFixed(2) : 0;

      return {
        total,
        pending,
        answered,
        closed,
        unanswered,
        withAcceptedAnswers: withAcceptedAnswer,
        answerRate: parseFloat(answerRate),
        acceptanceRate: parseFloat(acceptanceRate),
        totalViews: totalViews[0]?.total || 0,
        totalLikes: totalLikes[0]?.total || 0,
      };
    } catch (error) {
      logError(error, "QuestionService.getQuestionStatistics");
      throw error;
    }
  }

  // Получение вопросов пользователя
  async getUserQuestions(userId, options = {}) {
    try {
      const { page = 1, limit = 20, status = null } = options;
      const skip = (page - 1) * limit;

      const query = { author: userId };
      if (status) query.status = status;

      const [questions, total] = await Promise.all([
        Question.find(query)
          .populate("author", "firstName lastName email role avatar")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Question.countDocuments(query),
      ]);

      await cryptoService.smartDecrypt(questions);

      return createPaginationResponse(questions, total, page, limit);
    } catch (error) {
      logError(error, "QuestionService.getUserQuestions");
      throw error;
    }
  }

  // Получение топ вопросов (по лайкам/просмотрам)
  async getTopQuestions(options = {}) {
    try {
      const { limit = 10, period = 30, sortBy = "likes" } = options;

      let dateFilter = {};
      if (period > 0) {
        const periodDate = new Date();
        periodDate.setDate(periodDate.getDate() - period);
        dateFilter = { createdAt: { $gte: periodDate } };
      }

      const questions = await Question.find(dateFilter)
        .populate("author", "firstName lastName email role avatar")
        .sort({ [sortBy]: -1, views: -1 })
        .limit(limit);

      await cryptoService.smartDecrypt(questions);

      return questions;
    } catch (error) {
      logError(error, "QuestionService.getTopQuestions");
      throw error;
    }
  }
}

export default new QuestionService();
