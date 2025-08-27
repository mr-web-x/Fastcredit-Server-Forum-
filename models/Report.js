// models/Report.js
import mongoose from "mongoose";
import {
  REPORT_TARGET_TYPES,
  REPORT_REASONS,
  REPORT_STATUS,
} from "../utils/constants.js";

const reportSchema = new mongoose.Schema(
  {
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: Object.values(REPORT_TARGET_TYPES),
      required: true,
      index: true,
    },
    reason: {
      type: String,
      enum: Object.values(REPORT_REASONS),
      required: true,
      index: true,
    },
    description: {
      type: String,
      maxlength: 1000,
      trim: true,
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(REPORT_STATUS),
      default: REPORT_STATUS.PENDING,
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    adminComment: {
      type: String,
      maxlength: 500,
      default: null,
    },
    actionTaken: {
      type: String,
      maxlength: 200,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Составные индексы
reportSchema.index(
  { reportedBy: 1, targetId: 1, targetType: 1 },
  { unique: true }
);
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ targetId: 1, targetType: 1 });
reportSchema.index({ reviewedBy: 1, reviewedAt: -1 });

// Виртуальные поля
reportSchema.virtual("isPending").get(function () {
  return this.status === REPORT_STATUS.PENDING;
});

reportSchema.virtual("isResolved").get(function () {
  return this.status === REPORT_STATUS.RESOLVED;
});

reportSchema.virtual("isReviewed").get(function () {
  return this.status === REPORT_STATUS.REVIEWED;
});

// Методы экземпляра
reportSchema.methods.markAsReviewed = async function (adminId, comment = null) {
  this.status = REPORT_STATUS.REVIEWED;
  this.reviewedBy = adminId;
  this.reviewedAt = new Date();
  this.adminComment = comment;
  return await this.save();
};

reportSchema.methods.resolve = async function (
  adminId,
  actionTaken = null,
  comment = null
) {
  this.status = REPORT_STATUS.RESOLVED;
  this.reviewedBy = adminId;
  this.reviewedAt = new Date();
  this.actionTaken = actionTaken;
  this.adminComment = comment;
  return await this.save();
};

// Статические методы
reportSchema.statics.findPending = function () {
  return this.find({ status: REPORT_STATUS.PENDING })
    .populate("reportedBy", "email role")
    .populate("targetId")
    .sort({ createdAt: -1 });
};

reportSchema.statics.findByStatus = function (status) {
  return this.find({ status })
    .populate("reportedBy", "email role")
    .populate("reviewedBy", "email role")
    .populate("targetId")
    .sort({ createdAt: -1 });
};

reportSchema.statics.findByTarget = function (targetId, targetType) {
  return this.find({ targetId, targetType })
    .populate("reportedBy", "email role")
    .populate("reviewedBy", "email role")
    .sort({ createdAt: -1 });
};

reportSchema.statics.findByReporter = function (reporterId) {
  return this.find({ reportedBy: reporterId })
    .populate("targetId")
    .sort({ createdAt: -1 });
};

reportSchema.statics.findByAdmin = function (adminId) {
  return this.find({ reviewedBy: adminId })
    .populate("reportedBy", "email role")
    .populate("targetId")
    .sort({ reviewedAt: -1 });
};

reportSchema.statics.getMostReported = async function (limit = 10) {
  return await this.aggregate([
    {
      $group: {
        _id: { targetId: "$targetId", targetType: "$targetType" },
        reportCount: { $sum: 1 },
        reasons: { $push: "$reason" },
        latestReport: { $max: "$createdAt" },
      },
    },
    { $sort: { reportCount: -1, latestReport: -1 } },
    { $limit: limit },
  ]);
};

reportSchema.statics.getStatistics = async function () {
  const total = await this.countDocuments();
  const pending = await this.countDocuments({ status: REPORT_STATUS.PENDING });
  const reviewed = await this.countDocuments({
    status: REPORT_STATUS.REVIEWED,
  });
  const resolved = await this.countDocuments({
    status: REPORT_STATUS.RESOLVED,
  });

  // Статистика по причинам
  const byReason = await this.aggregate([
    {
      $group: {
        _id: "$reason",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  // Статистика по типам контента
  const byTargetType = await this.aggregate([
    {
      $group: {
        _id: "$targetType",
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  // Активность за последний месяц
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const recentReports = await this.countDocuments({
    createdAt: { $gte: lastMonth },
  });

  // Средние время обработки
  const avgProcessingTime = await this.aggregate([
    {
      $match: {
        status: { $in: [REPORT_STATUS.REVIEWED, REPORT_STATUS.RESOLVED] },
        reviewedAt: { $exists: true },
      },
    },
    {
      $project: {
        processingTime: {
          $subtract: ["$reviewedAt", "$createdAt"],
        },
      },
    },
    {
      $group: {
        _id: null,
        avgTime: { $avg: "$processingTime" },
      },
    },
  ]);

  return {
    total,
    pending,
    reviewed,
    resolved,
    recentReports,
    byReason,
    byTargetType,
    avgProcessingTimeMs: avgProcessingTime[0]?.avgTime || 0,
  };
};

reportSchema.statics.checkDuplicate = async function (
  reportedBy,
  targetId,
  targetType
) {
  const existing = await this.findOne({
    reportedBy,
    targetId,
    targetType,
  });

  return !!existing;
};

// Pre-save middleware
reportSchema.pre("save", function (next) {
  // Автоматически устанавливаем reviewedAt при изменении статуса
  if (
    this.isModified("status") &&
    this.status !== REPORT_STATUS.PENDING &&
    !this.reviewedAt
  ) {
    this.reviewedAt = new Date();
  }

  next();
});

const Report = mongoose.model("Report", reportSchema);

export default Report;
