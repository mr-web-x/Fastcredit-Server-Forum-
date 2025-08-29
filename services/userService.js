// services/userService.js
import User from "../models/User.js";
import Question from "../models/Question.js";
import Answer from "../models/Answer.js";
import Comment from "../models/Comment.js";
import { USER_ROLES } from "../utils/constants.js";
import { logUserAction, logError } from "../middlewares/logger.js";
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

  // Получение пользователя по username (для локальной авторизации)
  async getUserByUsername(username) {
    try {
      const user = await User.findOne({ username, provider: "local" }).select(
        "-__v"
      );
      return user;
    } catch (error) {
      logError(error, "UserService.getUserByUsername");
      throw error;
    }
  }

  // Проверка доступности email
  async isEmailAvailable(email) {
    try {
      const existingUser = await User.findOne({ email });
      return !existingUser;
    } catch (error) {
      logError(error, "UserService.isEmailAvailable");
      throw error;
    }
  }

  // Проверка доступности username
  async isUsernameAvailable(username) {
    try {
      const existingUser = await User.findOne({ username });
      return !existingUser;
    } catch (error) {
      logError(error, "UserService.isUsernameAvailable");
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
        provider = null,
        isActive = null,
        isBanned = null,
        isEmailVerified = null,
        search = null,
        sortBy = "createdAt",
        sortOrder = -1,
      } = options;

      const skip = (page - 1) * limit;
      const query = {};

      // Фильтры
      if (role) query.role = role;
      if (provider) query.provider = provider;
      if (isActive !== null) query.isActive = isActive;
      if (isBanned !== null) query.isBanned = isBanned;
      if (isEmailVerified !== null) query.isEmailVerified = isEmailVerified;

      // Поиск по email, username или имени
      if (search) {
        query.$or = [
          { email: { $regex: search, $options: "i" } },
          { username: { $regex: search, $options: "i" } },
          { firstName: { $regex: search, $options: "i" } },
          { lastName: { $regex: search, $options: "i" } },
        ];
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
      const userAllowedFields = ["bio", "avatar", "firstName", "lastName"];

      // Поля, которые может обновлять только админ
      const adminOnlyFields = [
        "role",
        "isActive",
        "isBanned",
        "bannedUntil",
        "bannedReason",
        "isEmailVerified",
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

      // Проверка уникальности username если обновляется
      if (updateData.username && updateData.username !== user.username) {
        if (isSelf || isAdmin) {
          const usernameExists = await User.findOne({
            username: updateData.username,
            _id: { $ne: userId },
          });

          if (usernameExists) {
            throw new Error("Username already taken");
          }

          filteredData.username = updateData.username;
        }
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

      if (error.message === "Username already taken") {
        throw new Error("Имя пользователя уже занято");
      }

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
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: user.fullName,
          provider: user.provider,
          role: user.role,
          avatar: user.avatar,
          bio: user.bio,
          rating: user.rating,
          totalAnswers: user.totalAnswers,
          totalQuestions: user.totalQuestions,
          isExpert: user.isExpert,
          isEmailVerified: user.isEmailVerified,
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
      const [totalStats, providerStats, roleStats, verificationStats] =
        await Promise.all([
          User.aggregate([
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                active: { $sum: { $cond: ["$isActive", 1, 0] } },
                banned: { $sum: { $cond: ["$isBanned", 1, 0] } },
                verified: { $sum: { $cond: ["$isEmailVerified", 1, 0] } },
              },
            },
          ]),

          User.aggregate([
            {
              $group: {
                _id: "$provider",
                count: { $sum: 1 },
                active: { $sum: { $cond: ["$isActive", 1, 0] } },
                verified: { $sum: { $cond: ["$isEmailVerified", 1, 0] } },
              },
            },
          ]),

          User.getStatistics(),

          User.aggregate([
            {
              $group: {
                _id: {
                  provider: "$provider",
                  verified: "$isEmailVerified",
                },
                count: { $sum: 1 },
              },
            },
          ]),
        ]);

      return {
        total: totalStats[0] || { total: 0, active: 0, banned: 0, verified: 0 },
        byProvider: providerStats.reduce((acc, stat) => {
          acc[stat._id] = stat;
          return acc;
        }, {}),
        byRole: roleStats,
        verification: verificationStats.reduce((acc, stat) => {
          const key = `${stat._id.provider}_${
            stat._id.verified ? "verified" : "unverified"
          }`;
          acc[key] = stat.count;
          return acc;
        }, {}),
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
        $or: [
          { email: { $regex: query, $options: "i" } },
          { username: { $regex: query, $options: "i" } },
          { firstName: { $regex: query, $options: "i" } },
          { lastName: { $regex: query, $options: "i" } },
        ],
      };

      if (role) {
        searchQuery.role = role;
      }

      const [users, total] = await Promise.all([
        User.find(searchQuery)
          .select(
            "email username firstName lastName role avatar bio totalAnswers totalQuestions createdAt provider isEmailVerified"
          )
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

  // Получение пользователей по provider
  async getUsersByProvider(provider, options = {}) {
    try {
      const { page = 1, limit = 20 } = options;
      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        User.find({ provider })
          .select("-__v")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        User.countDocuments({ provider }),
      ]);

      return createPaginationResponse(users, total, page, limit);
    } catch (error) {
      logError(error, "UserService.getUsersByProvider");
      throw error;
    }
  }

  // Получение неподтвержденных пользователей (для админки)
  async getUnverifiedUsers(options = {}) {
    try {
      const { page = 1, limit = 20 } = options;
      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        User.find({
          isEmailVerified: false,
          provider: "local",
        })
          .select("-__v")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        User.countDocuments({
          isEmailVerified: false,
          provider: "local",
        }),
      ]);

      return createPaginationResponse(users, total, page, limit);
    } catch (error) {
      logError(error, "UserService.getUnverifiedUsers");
      throw error;
    }
  }

  // Получение заблокированных аккаунтов (брутфорс защита)
  async getLockedAccounts(options = {}) {
    try {
      const { page = 1, limit = 20 } = options;
      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        User.find({
          lockUntil: { $gt: new Date() },
        })
          .select("email username lockUntil loginAttempts provider createdAt")
          .sort({ lockUntil: -1 })
          .skip(skip)
          .limit(limit),
        User.countDocuments({
          lockUntil: { $gt: new Date() },
        }),
      ]);

      return createPaginationResponse(users, total, page, limit);
    } catch (error) {
      logError(error, "UserService.getLockedAccounts");
      throw error;
    }
  }
}

export default new UserService();
