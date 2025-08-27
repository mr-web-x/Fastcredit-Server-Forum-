// services/userService.js
import User from "../models/User.js";
import Question from "../models/Question.js";
import Answer from "../models/Answer.js";
import Comment from "../models/Comment.js";
import RoleChange from "../models/RoleChange.js";
import { USER_ROLES } from "../utils/constants.js";
import {
  logUserAction,
  logError,
  logRoleChange,
} from "../middlewares/logger.js";
import { createPaginationResponse } from "../utils/helpers.js";

class UserService {
  // Получение пользователя по ID
  async getUserById(userId, includePrivate = false) {
    try {
      const selectFields = includePrivate ? "" : "-__v";
      const user = await User.findById(userId).select(selectFields);

      if (!user) {
        throw new Error("User not found");
      }

      return user;
    } catch (error) {
      logError(error, "UserService.getUserById", userId);
      throw error;
    }
  }

  // Получение пользователя по email
  async getUserByEmail(email) {
    try {
      const user = await User.findOne({ email }).select("-__v");
      return user;
    } catch (error) {
      logError(error, "UserService.getUserByEmail");
      throw error;
    }
  }

  // Получение списка пользователей с пагинацией
  async getUsers(options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        role = null,
        isActive = null,
        isBanned = null,
        search = null,
        sortBy = "createdAt",
        sortOrder = -1,
      } = options;

      const skip = (page - 1) * limit;
      const query = {};

      // Фильтры
      if (role) query.role = role;
      if (isActive !== null) query.isActive = isActive;
      if (isBanned !== null) query.isBanned = isBanned;

      // Поиск по email
      if (search) {
        query.email = { $regex: search, $options: "i" };
      }

      const [users, total] = await Promise.all([
        User.find(query)
          .select("-__v")
          .sort({ [sortBy]: sortOrder })
          .skip(skip)
          .limit(limit),
        User.countDocuments(query),
      ]);

      return createPaginationResponse(users, total, page, limit);
    } catch (error) {
      logError(error, "UserService.getUsers");
      throw error;
    }
  }

  // Получение экспертов
  async getExperts(options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        sortBy = "rating",
        sortOrder = -1,
      } = options;

      const skip = (page - 1) * limit;

      const [experts, total] = await Promise.all([
        User.find({
          role: { $in: [USER_ROLES.EXPERT, USER_ROLES.ADMIN] },
          isActive: true,
          isBanned: false,
        })
          .select("-__v")
          .sort({ [sortBy]: sortOrder, totalAnswers: -1 })
          .skip(skip)
          .limit(limit),
        User.countDocuments({
          role: { $in: [USER_ROLES.EXPERT, USER_ROLES.ADMIN] },
          isActive: true,
          isBanned: false,
        }),
      ]);

      return createPaginationResponse(experts, total, page, limit);
    } catch (error) {
      logError(error, "UserService.getExperts");
      throw error;
    }
  }

  // Обновление профиля пользователя
  async updateProfile(userId, updateData, updatedBy = null) {
    try {
      const user = await User.findById(userId);

      if (!user) {
        throw new Error("User not found");
      }

      // Поля, которые может обновлять сам пользователь
      const userAllowedFields = ["bio", "avatar"];

      // Поля, которые может обновлять только админ
      const adminOnlyFields = [
        "role",
        "isActive",
        "isBanned",
        "bannedUntil",
        "bannedReason",
      ];

      const filteredData = {};
      const isAdmin = updatedBy && updatedBy.role === USER_ROLES.ADMIN;
      const isSelf =
        updatedBy && updatedBy._id.toString() === userId.toString();

      // Обычные поля профиля
      userAllowedFields.forEach((field) => {
        if (updateData[field] !== undefined) {
          filteredData[field] = updateData[field];
        }
      });

      // Админские поля (только для админов)
      if (isAdmin) {
        adminOnlyFields.forEach((field) => {
          if (updateData[field] !== undefined) {
            filteredData[field] = updateData[field];
          }
        });
      }

      if (Object.keys(filteredData).length === 0) {
        throw new Error("No valid fields to update");
      }

      const updatedUser = await User.findByIdAndUpdate(userId, filteredData, {
        new: true,
        runValidators: true,
      }).select("-__v");

      const actionType = isSelf
        ? "PROFILE_SELF_UPDATED"
        : "PROFILE_ADMIN_UPDATED";
      const details = `Updated fields: ${Object.keys(filteredData).join(", ")}`;

      logUserAction(userId, actionType, details);

      return updatedUser;
    } catch (error) {
      logError(error, "UserService.updateProfile", userId);
      throw error;
    }
  }

  // Получение активности пользователя
  async getUserActivity(userId, options = {}) {
    try {
      const { page = 1, limit = 20 } = options;
      const skip = (page - 1) * limit;

      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      const [questions, answers, comments] = await Promise.all([
        Question.find({ author: userId })
          .select("title slug status createdAt views likes")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),

        Answer.find({ expert: userId, isApproved: true })
          .populate("questionId", "title slug")
          .select("questionId isAccepted likes createdAt")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),

        Comment.find({ author: userId, isApproved: true })
          .populate("questionId", "title slug")
          .select("questionId content likes createdAt")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
      ]);

      return {
        user: {
          id: user._id,
          email: user.email,
          role: user.role,
          avatar: user.avatar,
          bio: user.bio,
          rating: user.rating,
          totalAnswers: user.totalAnswers,
          totalQuestions: user.totalQuestions,
          isExpert: user.isExpert,
          createdAt: user.createdAt,
        },
        activity: {
          questions,
          answers,
          comments,
        },
      };
    } catch (error) {
      logError(error, "UserService.getUserActivity", userId);
      throw error;
    }
  }

  // Получение статистики пользователей
  async getUserStatistics() {
    try {
      const [
        totalUsers,
        activeUsers,
        experts,
        admins,
        bannedUsers,
        recentUsers,
      ] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ isActive: true, isBanned: false }),
        User.countDocuments({ role: USER_ROLES.EXPERT, isActive: true }),
        User.countDocuments({ role: USER_ROLES.ADMIN, isActive: true }),
        User.countDocuments({ isBanned: true }),
        User.countDocuments({
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        }),
      ]);

      // Статистика по ролям
      const roleStats = await User.aggregate([
        {
          $group: {
            _id: "$role",
            count: { $sum: 1 },
            active: { $sum: { $cond: ["$isActive", 1, 0] } },
            banned: { $sum: { $cond: ["$isBanned", 1, 0] } },
          },
        },
      ]);

      // Топ экспертов по рейтингу
      const topExperts = await User.find({
        role: { $in: [USER_ROLES.EXPERT, USER_ROLES.ADMIN] },
        isActive: true,
        totalAnswers: { $gt: 0 },
      })
        .select("email avatar rating totalAnswers")
        .sort({ rating: -1, totalAnswers: -1 })
        .limit(10);

      return {
        total: totalUsers,
        active: activeUsers,
        experts,
        admins,
        banned: bannedUsers,
        recentRegistrations: recentUsers,
        byRole: roleStats.reduce((acc, stat) => {
          acc[stat._id] = stat;
          return acc;
        }, {}),
        topExperts,
      };
    } catch (error) {
      logError(error, "UserService.getUserStatistics");
      throw error;
    }
  }

  // Поиск пользователей
  async searchUsers(query, options = {}) {
    try {
      const { page = 1, limit = 20, role = null } = options;
      const skip = (page - 1) * limit;

      const searchQuery = {
        email: { $regex: query, $options: "i" },
      };

      if (role) {
        searchQuery.role = role;
      }

      const [users, total] = await Promise.all([
        User.find(searchQuery)
          .select("email role avatar bio totalAnswers totalQuestions createdAt")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        User.countDocuments(searchQuery),
      ]);

      return createPaginationResponse(users, total, page, limit);
    } catch (error) {
      logError(error, "UserService.searchUsers");
      throw error;
    }
  }

  // Инкремент счетчиков пользователя
  async incrementUserCounter(userId, counterType) {
    try {
      const updateField = {};

      switch (counterType) {
        case "questions":
          updateField.totalQuestions = 1;
          break;
        case "answers":
          updateField.totalAnswers = 1;
          break;
        default:
          throw new Error(`Invalid counter type: ${counterType}`);
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { $inc: updateField },
        { new: true }
      );

      if (!user) {
        throw new Error("User not found");
      }

      logUserAction(
        userId,
        "COUNTER_INCREMENTED",
        `${counterType} counter incremented`
      );

      return user;
    } catch (error) {
      logError(error, "UserService.incrementUserCounter", userId);
      throw error;
    }
  }

  // Обновление рейтинга эксперта
  async updateUserRating(userId, newRating) {
    try {
      const user = await User.findByIdAndUpdate(
        userId,
        { rating: Math.max(0, newRating) },
        { new: true }
      );

      if (!user) {
        throw new Error("User not found");
      }

      logUserAction(userId, "RATING_UPDATED", `Rating updated to ${newRating}`);

      return user;
    } catch (error) {
      logError(error, "UserService.updateUserRating", userId);
      throw error;
    }
  }
}

export default new UserService();
