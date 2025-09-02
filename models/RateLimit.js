// models/RateLimit.js
import mongoose from "mongoose";
import { RATE_LIMIT_ACTIONS } from "../utils/constants.js";

const rateLimitSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    ip: {
      type: String,
      default: null,
      index: true,
    },
    action: {
      type: String,
      enum: Object.values(RATE_LIMIT_ACTIONS),
      required: true,
      index: true,
    },
    count: {
      type: Number,
      default: 1,
      min: 0,
    },
    windowStart: {
      type: Date,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Составные индексы
rateLimitSchema.index({ userId: 1, action: 1, windowStart: 1 });
rateLimitSchema.index({ ip: 1, action: 1, windowStart: 1 });

// Статические методы
rateLimitSchema.statics.checkLimit = async function (
  identifier,
  action,
  limit,
  windowMs
) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);

  // Определяем поле для поиска (userId или ip)
  const isUserId = mongoose.Types.ObjectId.isValid(identifier);
  const searchField = isUserId ? "userId" : "ip";
  const searchValue = isUserId ? identifier : identifier;

  // Ищем существующую запись
  let rateLimitRecord = await this.findOne({
    [searchField]: searchValue,
    action,
    windowStart: { $gte: windowStart },
  });

  if (!rateLimitRecord) {
    // Создаем новую запись
    rateLimitRecord = await this.create({
      [searchField]: searchValue,
      action,
      count: 1,
      windowStart: now,
      expiresAt: new Date(now.getTime() + windowMs),
    });

    return {
      allowed: true,
      count: 1,
      remaining: limit - 1,
      resetTime: rateLimitRecord.expiresAt,
    };
  }

  // Проверяем лимит
  if (rateLimitRecord.count >= limit) {
    return {
      allowed: false,
      count: rateLimitRecord.count,
      remaining: 0,
      resetTime: rateLimitRecord.expiresAt,
    };
  }

  // Увеличиваем счетчик
  rateLimitRecord.count += 1;
  await rateLimitRecord.save();

  return {
    allowed: true,
    count: rateLimitRecord.count,
    remaining: limit - rateLimitRecord.count,
    resetTime: rateLimitRecord.expiresAt,
  };
};

rateLimitSchema.statics.getCurrentCount = async function (
  identifier,
  action,
  windowMs
) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);

  const isUserId = mongoose.Types.ObjectId.isValid(identifier);
  const searchField = isUserId ? "userId" : "ip";

  const record = await this.findOne({
    [searchField]: identifier,
    action,
    windowStart: { $gte: windowStart },
  });

  return record ? record.count : 0;
};

rateLimitSchema.statics.resetLimit = async function (identifier, action) {
  const isUserId = mongoose.Types.ObjectId.isValid(identifier);
  const searchField = isUserId ? "userId" : "ip";

  await this.deleteMany({
    [searchField]: identifier,
    action,
  });
};

rateLimitSchema.statics.cleanupExpired = async function () {
  const result = await this.deleteMany({
    expiresAt: { $lt: new Date() },
  });

  return result.deletedCount;
};

rateLimitSchema.statics.getViolators = async function (
  action,
  limit,
  windowMs
) {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);

  return await this.find({
    action,
    count: { $gte: limit },
    windowStart: { $gte: windowStart },
  })
    .populate("userId", "email role")
    .sort({ count: -1 });
};

rateLimitSchema.statics.getUserActivity = async function (userId, hours = 24) {
  const timeAgo = new Date();
  timeAgo.setHours(timeAgo.getHours() - hours);

  return await this.find({
    userId,
    windowStart: { $gte: timeAgo },
  }).sort({ windowStart: -1 });
};

rateLimitSchema.statics.getStatistics = async function () {
  const now = new Date();
  const lastHour = new Date(now.getTime() - 3600000);
  const last24Hours = new Date(now.getTime() - 86400000);

  const total = await this.countDocuments();
  const activeLastHour = await this.countDocuments({
    windowStart: { $gte: lastHour },
  });
  const activeLast24Hours = await this.countDocuments({
    windowStart: { $gte: last24Hours },
  });

  // Статистика по действиям
  const byAction = await this.aggregate([
    {
      $match: {
        windowStart: { $gte: last24Hours },
      },
    },
    {
      $group: {
        _id: "$action",
        count: { $sum: "$count" },
        records: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  // Топ нарушителей
  const topViolators = await this.aggregate([
    {
      $match: {
        windowStart: { $gte: last24Hours },
        count: { $gte: 10 }, // условный порог
      },
    },
    {
      $group: {
        _id: { userId: "$userId", ip: "$ip" },
        totalRequests: { $sum: "$count" },
        actions: { $addToSet: "$action" },
      },
    },
    { $sort: { totalRequests: -1 } },
    { $limit: 10 },
  ]);

  return {
    total,
    activeLastHour,
    activeLast24Hours,
    byAction,
    topViolators,
  };
};

// Middleware для автоматической очистки
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RateLimit = mongoose.model("RateLimit", rateLimitSchema);

export default RateLimit;
