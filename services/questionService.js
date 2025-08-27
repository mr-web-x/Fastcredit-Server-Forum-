// services/questionService.js
import Question from "../models/Question.js";
import User from "../models/User.js";
import Answer from "../models/Answer.js";
import Comment from "../models/Comment.js";
import { QUESTION_STATUS, QUESTION_PRIORITY } from "../utils/constants.js";
import { logUserAction, logError } from "../middlewares/logger.js";
import {
  generateUniqueSlug,
  createPaginationResponse,
} from "../utils/helpers.js";

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
        "email role avatar"
      );

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
        "email role avatar bio rating"
      );

      if (!question) {
        throw new Error("Question not found");
      }

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
        sortBy = "createdAt",
        sortOrder = -1,
        search = null,
      } = options;

      const skip = (page - 1) * limit;
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
          .populate("author", "email role avatar")
          .sort(
            search ? { score: { $meta: "textScore" } } : { [sortBy]: sortOrder }
          )
          .skip(skip)
          .limit(limit),
        Question.countDocuments(query),
      ]);

      return createPaginationResponse(questions, total, page, limit);
    } catch (error) {
      logError(error, "QuestionService.getQuestions");
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
          .populate("author", "email role avatar")
          .sort({ priority: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Question.countDocuments(query),
      ]);

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

      // Обновляемые поля
      const allowedFields = ["title", "content", "category", "priority"];
      const filteredData = {};

      allowedFields.forEach((field) => {
        if (updateData[field] !== undefined) {
          filteredData[field] = updateData[field];
        }
      });

      if (Object.keys(filteredData).length === 0) {
        throw new Error("No valid fields to update");
      }

      // Если изменили заголовок, генерируем новый slug
      if (filteredData.title && filteredData.title !== question.title) {
        filteredData.slug = await generateUniqueSlug(
          filteredData.title,
          Question
        );
      }

      const updatedQuestion = await Question.findByIdAndUpdate(
        questionId,
        filteredData,
        { new: true, runValidators: true }
      ).populate("author", "email role avatar");

      logUserAction(
        userId,
        "QUESTION_UPDATED",
        `Updated question: ${updatedQuestion.slug}`
      );

      return updatedQuestion;
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

      // Удаляем связанные ответы и комментарии
      await Promise.all([
        Answer.deleteMany({ questionId }),
        Comment.deleteMany({ questionId }),
      ]);

      // Удаляем сам вопрос
      await Question.findByIdAndDelete(questionId);

      // Уменьшаем счетчик вопросов у автора
      await User.findByIdAndUpdate(question.author, {
        $inc: { totalQuestions: -1 },
      });

      logUserAction(
        userId,
        "QUESTION_DELETED",
        `Deleted question: ${question.slug}`
      );

      return true;
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

      const [questions, total] = await Promise.all([
        Question.find(
          { $text: { $search: searchQuery } },
          { score: { $meta: "textScore" } }
        )
          .populate("author", "email role avatar")
          .sort({ score: { $meta: "textScore" } })
          .skip(skip)
          .limit(limit),
        Question.countDocuments({ $text: { $search: searchQuery } }),
      ]);

      return createPaginationResponse(questions, total, page, limit);
    } catch (error) {
      logError(error, "QuestionService.searchQuestions");
      throw error;
    }
  }

  // Получение статистики по вопросам
  async getQuestionStatistics() {
    try {
      const [
        totalQuestions,
        pendingQuestions,
        answeredQuestions,
        closedQuestions,
        questionsWithAcceptedAnswers,
        recentQuestions,
      ] = await Promise.all([
        Question.countDocuments(),
        Question.countDocuments({ status: QUESTION_STATUS.PENDING }),
        Question.countDocuments({ status: QUESTION_STATUS.ANSWERED }),
        Question.countDocuments({ status: QUESTION_STATUS.CLOSED }),
        Question.countDocuments({ hasAcceptedAnswer: true }),
        Question.countDocuments({
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        }),
      ]);

      // Статистика по категориям
      const categoryStats = await Question.aggregate([
        {
          $group: {
            _id: "$category",
            count: { $sum: 1 },
            pending: {
              $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
            },
            answered: {
              $sum: { $cond: [{ $eq: ["$status", "answered"] }, 1, 0] },
            },
          },
        },
        { $sort: { count: -1 } },
      ]);

      // Самые просматриваемые вопросы
      const mostViewed = await Question.find()
        .populate("author", "email role")
        .sort({ views: -1 })
        .limit(10)
        .select("title slug views likes status");

      return {
        total: totalQuestions,
        pending: pendingQuestions,
        answered: answeredQuestions,
        closed: closedQuestions,
        withAcceptedAnswers: questionsWithAcceptedAnswers,
        recent: recentQuestions,
        answerRate:
          totalQuestions > 0
            ? ((answeredQuestions / totalQuestions) * 100).toFixed(2)
            : 0,
        acceptanceRate:
          answeredQuestions > 0
            ? (
                (questionsWithAcceptedAnswers / answeredQuestions) *
                100
              ).toFixed(2)
            : 0,
        byCategory: categoryStats,
        mostViewed,
      };
    } catch (error) {
      logError(error, "QuestionService.getQuestionStatistics");
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

      // Поиск по схожему контенту (простая реализация)
      const keywords = question.title
        .split(" ")
        .filter((word) => word.length > 3);
      const searchQuery = keywords.join(" ");

      const similarQuestions = await Question.find({
        _id: { $ne: questionId },
        $text: { $search: searchQuery },
      })
        .populate("author", "email role avatar")
        .select("title slug views likes answersCount createdAt")
        .sort({ score: { $meta: "textScore" } })
        .limit(limit);

      return similarQuestions;
    } catch (error) {
      logError(error, "QuestionService.getSimilarQuestions");
      throw error;
    }
  }

  // Изменение статуса вопроса
  async changeQuestionStatus(questionId, newStatus, userId) {
    try {
      const question = await Question.findById(questionId);

      if (!question) {
        throw new Error("Question not found");
      }

      const oldStatus = question.status;
      question.status = newStatus;

      if (newStatus === QUESTION_STATUS.ANSWERED && !question.answeredAt) {
        question.answeredAt = new Date();
      }

      await question.save();

      logUserAction(
        userId,
        "QUESTION_STATUS_CHANGED",
        `Changed status of question ${question.slug} from ${oldStatus} to ${newStatus}`
      );

      return question;
    } catch (error) {
      logError(error, "QuestionService.changeQuestionStatus", userId);
      throw error;
    }
  }
}

export default new QuestionService();
