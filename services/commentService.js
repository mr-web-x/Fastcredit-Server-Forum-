// services/commentService.js
import Comment from "../models/Comment.js";
import Question from "../models/Question.js";
import User from "../models/User.js";
import { logUserAction, logError } from "../middlewares/logger.js";
import { createPaginationResponse } from "../utils/helpers.js";
import cryptoService from "./cryptoService.js";

class CommentService {
  // Создание комментария к вопросу
  async createComment(commentData, authorId) {
    try {
      const { content, questionId, parentComment = null } = commentData;

      // Проверяем существование вопроса
      const question = await Question.findById(questionId);
      if (!question) {
        throw new Error("Otázka nebola nájdená");
      }

      // Проверяем существование родительского комментария (если указан)
      if (parentComment) {
        const parent = await Comment.findById(parentComment);
        if (!parent) {
          throw new Error("Rodičovský komentár nebol nájdený");
        }

        // Проверяем, что родительский комментарий относится к тому же вопросу
        if (parent.questionId.toString() !== questionId.toString()) {
          throw new Error("Rodičovský komentár nepatrí k tejto otázke");
        }
      }

      // Создаем комментарий (по умолчанию одобрен)
      const comment = new Comment({
        content,
        questionId,
        author: authorId,
        parentComment,
        isApproved: true, // комментарии одобряются автоматически
      });

      await comment.save();

      // Загружаем комментарий с автором
      const populatedComment = await Comment.findById(comment._id)
        .populate("author", "firstName lastName email role avatar")
        .populate("parentComment", "content author");

      logUserAction(
        authorId,
        "COMMENT_CREATED",
        `Created comment on question: ${question.slug}`
      );

      return populatedComment;
    } catch (error) {
      logError(error, "CommentService.createComment", authorId);
      throw error;
    }
  }

  // Получение комментариев к вопросу
  async getCommentsForQuestion(questionId, options = {}) {
    try {
      const { includeUnapproved = false } = options;

      const query = { questionId, parentComment: null };

      // Обычные пользователи видят только одобренные комментарии
      if (!includeUnapproved) {
        query.isApproved = true;
      }

      const comments = await Comment.find(query)
        .populate("author", "firstName lastName email role avatar")
        .populate({
          path: "replies",
          match: includeUnapproved ? {} : { isApproved: true },
          populate: {
            path: "author",
            select: "email role avatar",
          },
          options: { sort: { createdAt: 1 } },
        })
        .sort({ createdAt: 1 });

      return comments;
    } catch (error) {
      logError(error, "CommentService.getCommentsForQuestion");
      throw error;
    }
  }

  // Получение ответов на комментарий
  async getCommentReplies(parentCommentId, options = {}) {
    try {
      const { includeUnapproved = false } = options;

      const query = { parentComment: parentCommentId };

      if (!includeUnapproved) {
        query.isApproved = true;
      }

      const replies = await Comment.find(query)
        .populate("author", "firstName lastName email role avatar")
        .sort({ createdAt: 1 });

      return replies;
    } catch (error) {
      logError(error, "CommentService.getCommentReplies");
      throw error;
    }
  }

  // Получение комментариев пользователя
  async getUserComments(userId, options = {}) {
    try {
      const { page = 1, limit = 20, isApproved = true } = options;
      const skip = (page - 1) * limit;

      const query = { author: userId };
      if (isApproved !== null) query.isApproved = isApproved;

      const [comments, total] = await Promise.all([
        Comment.find(query)
          .populate("questionId", "title slug")
          .populate("parentComment", "content author")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Comment.countDocuments(query),
      ]);

      return createPaginationResponse(comments, total, page, limit);
    } catch (error) {
      logError(error, "CommentService.getUserComments", userId);
      throw error;
    }
  }

  // Обновление комментария
  async updateComment(commentId, updateData, userId) {
    try {
      const comment = await Comment.findById(commentId);

      if (!comment) {
        throw new Error("Komentár nebol nájdený");
      }

      // Проверяем права (автор комментария или админ)
      const user = await User.findById(userId);
      const canEdit =
        comment.author.toString() === userId.toString() ||
        user.role === "admin";

      if (!canEdit) {
        throw new Error("Nemáte oprávnenie upraviť tento komentár");
      }

      // Проверяем время редактирования (можно редактировать только в течение 10 минут)
      const timeDiff = Date.now() - comment.createdAt.getTime();
      const canEditTime = timeDiff < 10 * 60 * 1000; // 10 минут

      if (!canEditTime && user.role !== "admin") {
        throw new Error(
          "Komentár je možné upraviť iba do 10 minút od vytvorenia"
        );
      }

      const { content } = updateData;
      if (!content) {
        throw new Error("Obsah je povinný");
      }

      comment.content = content;
      await comment.save();

      logUserAction(userId, "COMMENT_UPDATED", `Updated comment ${commentId}`);

      const resultComment = await Comment.findById(commentId).populate(
        "author",
        "originalEmail role avatar"
      );

      await cryptoService.smartDecrypt(resultComment);

      return resultComment;
    } catch (error) {
      logError(error, "CommentService.updateComment", userId);
      throw error;
    }
  }

  // Удаление комментария
  async deleteComment(commentId, userId) {
    try {
      const comment = await Comment.findById(commentId);

      if (!comment) {
        throw new Error("Komentár nebol nájdený");
      }

      // Проверяем права (автор комментария или админ)
      const user = await User.findById(userId);
      const canDelete =
        comment.author.toString() === userId.toString() ||
        user.role === "admin";

      if (!canDelete) {
        throw new Error("Nemáte oprávnenie odstrániť tento komentár");
      }

      // Удаляем комментарий (это также удалит все ответы на него через pre-remove middleware)
      await Comment.findByIdAndDelete(commentId);

      logUserAction(userId, "COMMENT_DELETED", `Deleted comment ${commentId}`);

      return true;
    } catch (error) {
      logError(error, "CommentService.deleteComment", userId);
      throw error;
    }
  }

  // Модерация комментария (только админы)
  async moderateComment(commentId, isApproved, moderatorId) {
    try {
      const comment = await Comment.findById(commentId);

      if (!comment) {
        throw new Error("Komentár nebol nájdený");
      }

      // Проверяем права модератора
      const moderator = await User.findById(moderatorId);
      if (!moderator || !moderator.canModerate) {
        throw new Error("Iba moderátori môžu moderovať komentáre");
      }

      await comment.moderate(moderatorId, isApproved);

      const action = isApproved ? "COMMENT_APPROVED" : "COMMENT_REJECTED";
      logUserAction(
        moderatorId,
        action,
        `${action.toLowerCase()} comment ${commentId}`
      );

      const resultComment = await Comment.findById(commentId)
        .populate("author", "firstName lastName originalEmail role avatar")
        .populate("moderatedBy", "originalEmail role");

      await cryptoService.smartDecrypt(resultComment);

      return resultComment;
    } catch (error) {
      logError(error, "CommentService.moderateComment", moderatorId);
      throw error;
    }
  }

  // Получение комментариев на модерации
  async getPendingComments(options = {}) {
    try {
      const { page = 1, limit = 20 } = options;
      const skip = (page - 1) * limit;

      const [comments, total] = await Promise.all([
        Comment.find({ isApproved: false })
          .populate("author", "firstName lastName email role avatar")
          .populate("questionId", "title slug")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Comment.countDocuments({ isApproved: false }),
      ]);

      return createPaginationResponse(comments, total, page, limit);
    } catch (error) {
      logError(error, "CommentService.getPendingComments");
      throw error;
    }
  }

  // Статистика по комментариям
  async getCommentStatistics() {
    try {
      const [
        totalComments,
        approvedComments,
        pendingComments,
        topLevelComments,
        replies,
        recentComments,
      ] = await Promise.all([
        Comment.countDocuments(),
        Comment.countDocuments({ isApproved: true }),
        Comment.countDocuments({ isApproved: false }),
        Comment.countDocuments({ parentComment: null }),
        Comment.countDocuments({ parentComment: { $ne: null } }),
        Comment.countDocuments({
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        }),
      ]);

      // Самые активные комментаторы
      const topCommenters = await Comment.aggregate([
        { $match: { isApproved: true } },
        {
          $group: {
            _id: "$author",
            totalComments: { $sum: 1 },
            totalLikes: { $sum: "$likes" },
          },
        },
        { $sort: { totalComments: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user",
            pipeline: [{ $project: { email: 1, role: 1, avatar: 1 } }],
          },
        },
        { $unwind: "$user" },
      ]);

      // Вопросы с наибольшим количеством комментариев
      const mostCommentedQuestions = await Comment.aggregate([
        { $match: { isApproved: true } },
        {
          $group: {
            _id: "$questionId",
            commentsCount: { $sum: 1 },
          },
        },
        { $sort: { commentsCount: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: "questions",
            localField: "_id",
            foreignField: "_id",
            as: "question",
            pipeline: [{ $project: { title: 1, slug: 1 } }],
          },
        },
        { $unwind: "$question" },
      ]);

      return {
        total: totalComments,
        approved: approvedComments,
        pending: pendingComments,
        topLevel: topLevelComments,
        replies,
        recent: recentComments,
        approvalRate:
          totalComments > 0
            ? ((approvedComments / totalComments) * 100).toFixed(2)
            : 0,
        topCommenters,
        mostCommentedQuestions,
      };
    } catch (error) {
      logError(error, "CommentService.getCommentStatistics");
      throw error;
    }
  }

  // Поиск комментариев
  async searchComments(searchQuery, options = {}) {
    try {
      const { page = 1, limit = 20, userId = null } = options;
      const skip = (page - 1) * limit;

      const query = {
        content: { $regex: searchQuery, $options: "i" },
        isApproved: true,
      };

      if (userId) {
        query.author = userId;
      }

      const [comments, total] = await Promise.all([
        Comment.find(query)
          .populate("author", "firstName lastName email role avatar")
          .populate("questionId", "title slug")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Comment.countDocuments(query),
      ]);

      return createPaginationResponse(comments, total, page, limit);
    } catch (error) {
      logError(error, "CommentService.searchComments");
      throw error;
    }
  }

  // Получение популярных комментариев
  async getPopularComments(options = {}) {
    try {
      const { limit = 10, minLikes = 5 } = options;

      const comments = await Comment.find({
        isApproved: true,
        likes: { $gte: minLikes },
      })
        .populate("author", "firstName lastName email role avatar")
        .populate("questionId", "title slug")
        .sort({ likes: -1, createdAt: -1 })
        .limit(limit);

      return comments;
    } catch (error) {
      logError(error, "CommentService.getPopularComments");
      throw error;
    }
  }
}

export default new CommentService();
