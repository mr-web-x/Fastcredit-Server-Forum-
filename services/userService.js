// services/userService.js
import User from "../models/User.js";
import Question from "../models/Question.js";
import Answer from "../models/Answer.js";
import Comment from "../models/Comment.js";
import { USER_ROLES } from "../utils/constants.js";
import { logUserAction, logError } from "../middlewares/logger.js";
import { createPaginationResponse } from "../utils/helpers.js";
import cryptoService from "../services/cryptoService.js";

class UserService {
  // ==================== ПОИСК ПО ID ====================
  async getUserById(userId, includePrivate = false) {
    try {
      const selectFields = includePrivate ? "" : "-__v";
      const resultUser = await User.findById(userId).select(selectFields);

      if (!resultUser) throw new Error("User not found");

      await cryptoService.smartDecrypt(resultUser);
      return resultUser;
    } catch (error) {
      logError(error, "UserService.getUserById", userId);
      throw error;
    }
  }

  // ==================== ПОИСК ПО EMAIL ====================
  async getUserByEmail(email) {
    try {
      const hashedEmail = await cryptoService.hashData(email.toLowerCase());
      const resultUser = await User.findOne({ email: hashedEmail }).select(
        "-__v"
      );

      await cryptoService.smartDecrypt(resultUser);

      return resultUser;
    } catch (error) {
      logError(error, "UserService.getUserByEmail");
      throw error;
    }
  }

  // ==================== ПОИСК ПО USERNAME ====================
  async getUserByUsername(username) {
    try {
      const resultUser = await User.findOne({
        username,
        provider: "local",
      }).select("-__v");
      await cryptoService.smartDecrypt(resultUser);
      return resultUser;
    } catch (error) {
      logError(error, "UserService.getUserByUsername");
      throw error;
    }
  }

  // ==================== ПРОВЕРКА ДОСТУПНОСТИ EMAIL ====================
  async isEmailAvailable(email) {
    try {
      const hashedEmail = await cryptoService.hashData(email.toLowerCase());
      const existingUser = await User.findOne({ email: hashedEmail });
      return !existingUser;
    } catch (error) {
      logError(error, "UserService.isEmailAvailable");
      throw error;
    }
  }

  // ==================== ПРОВЕРКА ДОСТУПНОСТИ USERNAME ====================
  async isUsernameAvailable(username) {
    try {
      const existingUser = await User.findOne({ username });
      return !existingUser;
    } catch (error) {
      logError(error, "UserService.isUsernameAvailable");
      throw error;
    }
  }

  // ==================== СПИСОК ПОЛЬЗОВАТЕЛЕЙ ====================
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
        sortBy = "createdAt",
        sortOrder = -1,
      } = options;

      const skip = (page - 1) * limit;
      const query = {};

      if (role) query.role = role;
      if (provider) query.provider = provider;
      if (isActive !== null) query.isActive = isActive;
      if (isBanned !== null) query.isBanned = isBanned;
      if (isEmailVerified !== null) query.isEmailVerified = isEmailVerified;

      const [users, total] = await Promise.all([
        User.find(query)
          .select("-__v")
          .sort({ [sortBy]: sortOrder })
          .skip(skip)
          .limit(limit),
        User.countDocuments(query),
      ]);

      await cryptoService.smartDecrypt(users);

      return createPaginationResponse(users, total, page, limit);
    } catch (error) {
      logError(error, "UserService.getUsers");
      throw error;
    }
  }

  // ==================== ЭКСПЕРТЫ ====================
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

      await cryptoService.smartDecrypt(experts);

      return createPaginationResponse(experts, total, page, limit);
    } catch (error) {
      logError(error, "UserService.getExperts");
      throw error;
    }
  }

  // ==================== ОБНОВЛЕНИЕ ПРОФИЛЯ ====================
  async updateProfile(userId, updateData, updatedBy = null) {
    try {
      const resultUser = await User.findById(userId);
      if (!resultUser) throw new Error("User not found");

      const userAllowedFields = ["bio", "avatar", "firstName", "lastName"];
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

      userAllowedFields.forEach((field) => {
        if (updateData[field] !== undefined)
          filteredData[field] = updateData[field];
      });

      if (isAdmin) {
        adminOnlyFields.forEach((field) => {
          if (updateData[field] !== undefined)
            filteredData[field] = updateData[field];
        });
      }

      if (updateData.username && updateData.username !== resultUser.username) {
        if (isSelf || isAdmin) {
          const usernameExists = await User.findOne({
            username: updateData.username,
            _id: { $ne: userId },
          });
          if (usernameExists) throw new Error("Username already taken");
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

      await cryptoService.smartDecrypt(updatedUser);

      logUserAction(
        userId,
        isSelf ? "PROFILE_SELF_UPDATED" : "PROFILE_ADMIN_UPDATED",
        `Updated fields: ${Object.keys(filteredData).join(", ")}`
      );

      return updatedUser;
    } catch (error) {
      logError(error, "UserService.updateProfile", userId);
      throw error;
    }
  }

  // ==================== АКТИВНОСТЬ ПОЛЬЗОВАТЕЛЯ ====================
  async getUserActivity(userId, options = {}) {
    try {
      const { page = 1, limit = 20 } = options;
      const skip = (page - 1) * limit;

      const resultUser = await User.findById(userId);
      if (!resultUser) throw new Error("User not found");

      await cryptoService.smartDecrypt(resultUser);

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
        user: resultUser,
        activity: { questions, answers, comments },
      };
    } catch (error) {
      logError(error, "UserService.getUserActivity", userId);
      throw error;
    }
  }

  // ==================== ПРОЧИЕ МЕТОДЫ (статистика, counters) ====================
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
                _id: { provider: "$provider", verified: "$isEmailVerified" },
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
}

export default new UserService();
