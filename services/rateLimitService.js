// services/rateLimitService.js
import RateLimit from "../models/RateLimit.js";
import User from "../models/User.js";
import { USER_ROLES, RATE_LIMIT_ACTIONS } from "../utils/constants.js";
import {
  logUserAction,
  logError,
  logSecurityEvent,
} from "../middlewares/logger.js";
import { createPaginationResponse, getClientIP } from "../utils/helpers.js";
import config from "../config/index.js";

class RateLimitService {
  // Получение текущих лимитов пользователя
  async getUserLimits(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("Používateľ nebol nájdený");
      }

      const limits = this.getLimitsForRole(user.role);
      const windowMs = config.RATE_LIMIT.WINDOW_MS;

      // Получаем текущее использование
      const now = new Date();
      const windowStart = new Date(now.getTime() - windowMs);

      const currentUsage = await RateLimit.find({
        userId,
        windowStart: { $gte: windowStart },
      });

      const usage = {};

      // Подсчитываем использование по действиям
      Object.values(RATE_LIMIT_ACTIONS).forEach((action) => {
        const actionUsage = currentUsage.filter((r) => r.action === action);
        const totalCount = actionUsage.reduce((sum, r) => sum + r.count, 0);

        usage[action] = {
          current: totalCount,
          limit: limits[action] || limits.API_REQUESTS,
          remaining: Math.max(
            0,
            (limits[action] || limits.API_REQUESTS) - totalCount
          ),
          resetTime: new Date(now.getTime() + windowMs),
        };
      });

      return {
        userId,
        userRole: user.role,
        windowMs,
        limits,
        usage,
      };
    } catch (error) {
      logError(error, "RateLimitService.getUserLimits", userId);
      throw error;
    }
  }

  // Получение лимитов для роли
  getLimitsForRole(role) {
    switch (role) {
      case USER_ROLES.ADMIN:
        return config.RATE_LIMIT.ADMIN;
      case USER_ROLES.EXPERT:
        return config.RATE_LIMIT.EXPERT;
      default:
        return config.RATE_LIMIT.USER;
    }
  }

  // Сброс лимитов пользователя (только админы)
  async resetUserLimits(userId, adminId, action = null) {
    try {
      const admin = await User.findById(adminId);
      if (!admin || admin.role !== USER_ROLES.ADMIN) {
        throw new Error("Len administrátori môžu resetovať limity");
      }

      const query = { userId };
      if (action) {
        query.action = action;
      }

      const deletedCount = await RateLimit.deleteMany(query);

      logUserAction(
        adminId,
        "RATE_LIMITS_RESET",
        `Reset ${action || "all"} rate limits for user ${userId}. Deleted ${
          deletedCount.deletedCount
        } records`
      );

      return {
        userId,
        action: action || "all",
        resetBy: adminId,
        recordsDeleted: deletedCount.deletedCount,
      };
    } catch (error) {
      logError(error, "RateLimitService.resetUserLimits", adminId);
      throw error;
    }
  }

  // Получение пользователей с превышением лимитов
  async getUsersExceedingLimits(options = {}) {
    try {
      const {
        action = null,
        page = 1,
        limit = 20,
        timeWindow = 3600000, // 1 час по умолчанию
      } = options;

      const now = new Date();
      const windowStart = new Date(now.getTime() - timeWindow);

      const pipeline = [
        {
          $match: {
            windowStart: { $gte: windowStart },
            ...(action && { action }),
          },
        },
        {
          $group: {
            _id: { userId: "$userId", action: "$action" },
            totalCount: { $sum: "$count" },
            records: { $sum: 1 },
            lastHit: { $max: "$createdAt" },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id.userId",
            foreignField: "_id",
            as: "user",
            pipeline: [{ $project: { email: 1, role: 1, isActive: 1 } }],
          },
        },
        { $unwind: "$user" },
        {
          $addFields: {
            limit: {
              $switch: {
                branches: [
                  {
                    case: { $eq: ["$user.role", "admin"] },
                    then: config.RATE_LIMIT.ADMIN.API_REQUESTS,
                  },
                  {
                    case: { $eq: ["$user.role", "expert"] },
                    then: config.RATE_LIMIT.EXPERT.API_REQUESTS,
                  },
                ],
                default: config.RATE_LIMIT.USER.API_REQUESTS,
              },
            },
          },
        },
        {
          $match: {
            $expr: { $gte: ["$totalCount", "$limit"] },
          },
        },
        { $sort: { totalCount: -1, lastHit: -1 } },
      ];

      const skip = (page - 1) * limit;
      const [results, totalCount] = await Promise.all([
        RateLimit.aggregate([...pipeline, { $skip: skip }, { $limit: limit }]),
        RateLimit.aggregate([...pipeline, { $count: "total" }]),
      ]);

      const total = totalCount[0]?.total || 0;

      return createPaginationResponse(results, total, page, limit);
    } catch (error) {
      logError(error, "RateLimitService.getUsersExceedingLimits");
      throw error;
    }
  }

  // Статистика по rate limiting
  async getRateLimitStatistics(hours = 24) {
    try {
      const timeAgo = new Date();
      timeAgo.setHours(timeAgo.getHours() - hours);

      // Общая статистика
      const [totalRequests, uniqueUsers, totalBlocked] = await Promise.all([
        RateLimit.aggregate([
          { $match: { createdAt: { $gte: timeAgo } } },
          { $group: { _id: null, total: { $sum: "$count" } } },
        ]),
        RateLimit.distinct("userId", { createdAt: { $gte: timeAgo } }),
        RateLimit.countDocuments({
          createdAt: { $gte: timeAgo },
          count: { $gte: config.RATE_LIMIT.USER.API_REQUESTS },
        }),
      ]);

      // Статистика по действиям
      const byAction = await RateLimit.aggregate([
        { $match: { createdAt: { $gte: timeAgo } } },
        {
          $group: {
            _id: "$action",
            totalRequests: { $sum: "$count" },
            uniqueUsers: { $addToSet: "$userId" },
            records: { $sum: 1 },
          },
        },
        {
          $addFields: {
            uniqueUsersCount: { $size: "$uniqueUsers" },
          },
        },
        { $project: { uniqueUsers: 0 } },
        { $sort: { totalRequests: -1 } },
      ]);

      // Статистика по ролям
      const byRole = await RateLimit.aggregate([
        { $match: { createdAt: { $gte: timeAgo } } },
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "_id",
            as: "user",
            pipeline: [{ $project: { role: 1 } }],
          },
        },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $ifNull: ["$user.role", "anonymous"] },
            totalRequests: { $sum: "$count" },
            uniqueUsers: { $addToSet: "$userId" },
            records: { $sum: 1 },
          },
        },
        {
          $addFields: {
            uniqueUsersCount: { $size: "$uniqueUsers" },
          },
        },
        { $project: { uniqueUsers: 0 } },
        { $sort: { totalRequests: -1 } },
      ]);

      // Топ нарушители
      const topViolators = await RateLimit.aggregate([
        { $match: { createdAt: { $gte: timeAgo } } },
        {
          $group: {
            _id: "$userId",
            totalRequests: { $sum: "$count" },
            actions: { $addToSet: "$action" },
            lastActivity: { $max: "$createdAt" },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "user",
            pipeline: [{ $project: { email: 1, role: 1 } }],
          },
        },
        { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
        { $sort: { totalRequests: -1 } },
        { $limit: 10 },
      ]);

      return {
        period: `${hours} hours`,
        summary: {
          totalRequests: totalRequests[0]?.total || 0,
          uniqueUsers: uniqueUsers.length,
          totalBlocked,
          avgRequestsPerUser:
            uniqueUsers.length > 0
              ? Math.round((totalRequests[0]?.total || 0) / uniqueUsers.length)
              : 0,
        },
        byAction,
        byRole,
        topViolators,
      };
    } catch (error) {
      logError(error, "RateLimitService.getRateLimitStatistics");
      throw error;
    }
  }

  // Проверка лимита без инкремента (для предпросмотра)
  async checkLimitWithoutIncrement(identifier, action) {
    try {
      const isUserId = /^[0-9a-fA-F]{24}$/.test(identifier);
      let user = null;
      let limit = config.RATE_LIMIT.USER.API_REQUESTS;

      if (isUserId) {
        user = await User.findById(identifier);
        if (user) {
          const limits = this.getLimitsForRole(user.role);
          limit = limits[action] || limits.API_REQUESTS;
        }
      }

      const currentCount = await RateLimit.getCurrentCount(
        identifier,
        action,
        config.RATE_LIMIT.WINDOW_MS
      );

      return {
        identifier,
        action,
        currentCount,
        limit,
        remaining: Math.max(0, limit - currentCount),
        wouldExceed: currentCount >= limit,
        userRole: user?.role || "anonymous",
      };
    } catch (error) {
      logError(error, "RateLimitService.checkLimitWithoutIncrement");
      throw error;
    }
  }

  // Получение истории rate limit для пользователя
  async getUserRateLimitHistory(userId, options = {}) {
    try {
      const { page = 1, limit = 50, action = null, hoursBack = 24 } = options;

      const timeAgo = new Date();
      timeAgo.setHours(timeAgo.getHours() - hoursBack);

      const query = {
        userId,
        createdAt: { $gte: timeAgo },
      };

      if (action) {
        query.action = action;
      }

      const skip = (page - 1) * limit;

      const [records, total] = await Promise.all([
        RateLimit.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
        RateLimit.countDocuments(query),
      ]);

      return createPaginationResponse(records, total, page, limit);
    } catch (error) {
      logError(error, "RateLimitService.getUserRateLimitHistory", userId);
      throw error;
    }
  }

  // Автоматическая очистка старых записей
  async cleanupExpiredRecords() {
    try {
      const deletedCount = await RateLimit.cleanupExpired();

      if (deletedCount > 0) {
        logUserAction(
          null,
          "RATE_LIMIT_CLEANUP",
          `Cleaned up ${deletedCount} expired rate limit records`
        );
      }

      return { deletedCount };
    } catch (error) {
      logError(error, "RateLimitService.cleanupExpiredRecords");
      throw error;
    }
  }

  // Временное увеличение лимитов для пользователя
  async grantTemporaryLimitIncrease(
    userId,
    adminId,
    multiplier = 2,
    durationHours = 24
  ) {
    try {
      const admin = await User.findById(adminId);
      if (!admin || admin.role !== USER_ROLES.ADMIN) {
        throw new Error("Len administrátori môžu udeliť dočasné zvýšenie limitu");
      }

      // В реальном проекте можно добавить поле temporaryLimitIncrease в User модель
      // Пока что просто логируем

      logUserAction(
        adminId,
        "TEMPORARY_LIMIT_GRANTED",
        `Granted ${multiplier}x rate limit increase to user ${userId} for ${durationHours} hours`
      );

      return {
        userId,
        multiplier,
        durationHours,
        grantedBy: adminId,
        expiresAt: new Date(Date.now() + durationHours * 60 * 60 * 1000),
      };
    } catch (error) {
      logError(error, "RateLimitService.grantTemporaryLimitIncrease", adminId);
      throw error;
    }
  }

  // Анализ паттернов использования API
  async analyzeUsagePatterns(userId, days = 7) {
    try {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - days);

      const patterns = await RateLimit.aggregate([
        {
          $match: {
            userId: userId,
            createdAt: { $gte: daysAgo },
          },
        },
        {
          $group: {
            _id: {
              action: "$action",
              hour: { $hour: "$createdAt" },
              dayOfWeek: { $dayOfWeek: "$createdAt" },
            },
            avgRequests: { $avg: "$count" },
            totalRequests: { $sum: "$count" },
            sessions: { $sum: 1 },
          },
        },
        { $sort: { "_id.dayOfWeek": 1, "_id.hour": 1 } },
      ]);

      return {
        userId,
        analysisPeriod: `${days} days`,
        patterns,
        insights: this.generateUsageInsights(patterns),
      };
    } catch (error) {
      logError(error, "RateLimitService.analyzeUsagePatterns", userId);
      throw error;
    }
  }

  // Генерация инсайтов по использованию
  generateUsageInsights(patterns) {
    const insights = [];

    // Анализ пиковых часов
    const hourlyUsage = {};
    patterns.forEach((p) => {
      const hour = p._id.hour;
      hourlyUsage[hour] = (hourlyUsage[hour] || 0) + p.totalRequests;
    });

    const peakHour = Object.entries(hourlyUsage).sort(
      ([, a], [, b]) => b - a
    )[0];

    if (peakHour) {
      insights.push(
        `Peak usage at ${peakHour[0]}:00 with ${peakHour[1]} requests`
      );
    }

    // Анализ дней недели
    const dailyUsage = {};
    patterns.forEach((p) => {
      const day = p._id.dayOfWeek;
      dailyUsage[day] = (dailyUsage[day] || 0) + p.totalRequests;
    });

    const peakDay = Object.entries(dailyUsage).sort(([, a], [, b]) => b - a)[0];

    if (peakDay) {
      const dayNames = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      insights.push(
        `Most active on ${dayNames[peakDay[0] - 1]} with ${peakDay[1]} requests`
      );
    }

    return insights;
  }
}

export default new RateLimitService();
