// models/RoleChange.js
import mongoose from "mongoose";
import { USER_ROLES } from "../utils/constants.js";

const roleChangeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    oldRole: {
      type: String,
      enum: Object.values(USER_ROLES),
      required: true,
    },
    newRole: {
      type: String,
      enum: Object.values(USER_ROLES),
      required: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reason: {
      type: String,
      maxlength: 500,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Составные индексы
roleChangeSchema.index({ userId: 1, createdAt: -1 });
roleChangeSchema.index({ changedBy: 1, createdAt: -1 });
roleChangeSchema.index({ newRole: 1, createdAt: -1 });

// Статические методы
roleChangeSchema.statics.logRoleChange = async function (
  userId,
  oldRole,
  newRole,
  changedBy,
  reason = null
) {
  try {
    const roleChange = await this.create({
      userId,
      oldRole,
      newRole,
      changedBy,
      reason,
    });

    return roleChange;
  } catch (error) {
    console.error("Error logging role change:", error);
    throw error;
  }
};

roleChangeSchema.statics.getUserRoleHistory = function (userId) {
  return this.find({ userId })
    .populate("changedBy", "email role")
    .sort({ createdAt: -1 });
};

roleChangeSchema.statics.getAdminActions = function (adminId) {
  return this.find({ changedBy: adminId })
    .populate("userId", "email role")
    .sort({ createdAt: -1 });
};

roleChangeSchema.statics.getRecentPromotions = function (
  role = USER_ROLES.EXPERT,
  limit = 10
) {
  return this.find({ newRole: role })
    .populate("userId", "email role avatar")
    .populate("changedBy", "email role")
    .sort({ createdAt: -1 })
    .limit(limit);
};

roleChangeSchema.statics.getStatistics = async function () {
  const total = await this.countDocuments();

  const promotions = await this.countDocuments({
    oldRole: USER_ROLES.USER,
    newRole: { $in: [USER_ROLES.EXPERT, USER_ROLES.ADMIN] },
  });

  const demotions = await this.countDocuments({
    oldRole: { $in: [USER_ROLES.EXPERT, USER_ROLES.ADMIN] },
    newRole: USER_ROLES.USER,
  });

  const expertPromotions = await this.countDocuments({
    oldRole: USER_ROLES.USER,
    newRole: USER_ROLES.EXPERT,
  });

  const adminPromotions = await this.countDocuments({
    newRole: USER_ROLES.ADMIN,
  });

  // Статистика по месяцам
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentChanges = await this.countDocuments({
    createdAt: { $gte: thirtyDaysAgo },
  });

  // Топ админов по активности
  const topAdmins = await this.aggregate([
    {
      $group: {
        _id: "$changedBy",
        changes: { $sum: 1 },
      },
    },
    { $sort: { changes: -1 } },
    { $limit: 5 },
  ]);

  return {
    total,
    promotions,
    demotions,
    expertPromotions,
    adminPromotions,
    recentChanges,
    topAdmins,
  };
};

roleChangeSchema.statics.getRoleTransitions = async function () {
  return await this.aggregate([
    {
      $group: {
        _id: {
          from: "$oldRole",
          to: "$newRole",
        },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1 },
    },
  ]);
};

// Виртуальные поля
roleChangeSchema.virtual("isPromotion").get(function () {
  const roleHierarchy = {
    [USER_ROLES.USER]: 1,
    [USER_ROLES.EXPERT]: 2,
    [USER_ROLES.ADMIN]: 3,
  };

  return roleHierarchy[this.newRole] > roleHierarchy[this.oldRole];
});

roleChangeSchema.virtual("isDemotion").get(function () {
  const roleHierarchy = {
    [USER_ROLES.USER]: 1,
    [USER_ROLES.EXPERT]: 2,
    [USER_ROLES.ADMIN]: 3,
  };

  return roleHierarchy[this.newRole] < roleHierarchy[this.oldRole];
});

roleChangeSchema.virtual("changeType").get(function () {
  if (this.isPromotion) return "promotion";
  if (this.isDemotion) return "demotion";
  return "lateral";
});

const RoleChange = mongoose.model("RoleChange", roleChangeSchema);

export default RoleChange;
