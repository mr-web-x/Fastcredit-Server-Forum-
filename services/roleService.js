// services/roleService.js
import User from "../models/User.js";
import RoleChange from "../models/RoleChange.js";
import { USER_ROLES } from "../utils/constants.js";
import {
  logRoleChange,
  logUserAction,
  logError,
} from "../middlewares/logger.js";
import { createPaginationResponse } from "../utils/helpers.js";

class RoleService {
  // Изменение роли пользователя (только админы)
  async changeUserRole(userId, newRole, changedBy, reason = null) {
    try {
      // Валидация новой роли
      if (!Object.values(USER_ROLES).includes(newRole)) {
        throw new Error(`Neplatná rola: ${newRole}`);
      }

      // Получаем пользователя
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("Používateľ nebol nájdený");
      }

      const oldRole = user.role;

      // Проверяем, что роль действительно изменяется
      if (oldRole === newRole) {
        throw new Error("Používateľ už má túto rolu");
      }

      // Обновляем роль пользователя
      user.role = newRole;
      user.roleChangedAt = new Date();
      user.roleChangedBy = changedBy;

      // Если назначаем эксперта, сбрасываем bio для заполнения
      if (newRole === USER_ROLES.EXPERT && oldRole === USER_ROLES.USER) {
        user.bio = null;
      }

      await user.save();

      // Логируем изменение роли в модель RoleChange
      await RoleChange.logRoleChange(
        userId,
        oldRole,
        newRole,
        changedBy,
        reason
      );

      // Логируем в файл
      logRoleChange(userId, oldRole, newRole, changedBy);
      logUserAction(
        changedBy,
        "ROLE_CHANGED",
        `Changed role of user ${userId} from ${oldRole} to ${newRole}`
      );

      return {
        user: await User.findById(userId).select("-__v"),
        roleChange: {
          oldRole,
          newRole,
          changedBy,
          reason,
          changedAt: user.roleChangedAt,
        },
      };
    } catch (error) {
      logError(error, "RoleService.changeUserRole", userId);
      throw error;
    }
  }

  // Получение истории изменений ролей для пользователя
  async getUserRoleHistory(userId, options = {}) {
    try {
      const { page = 1, limit = 20 } = options;
      const skip = (page - 1) * limit;

      const [roleChanges, total] = await Promise.all([
        RoleChange.find({ userId })
          .populate("changedBy", "email role")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        RoleChange.countDocuments({ userId }),
      ]);

      return createPaginationResponse(roleChanges, total, page, limit);
    } catch (error) {
      logError(error, "RoleService.getUserRoleHistory", userId);
      throw error;
    }
  }

  // Получение всех изменений ролей (для админки)
  async getAllRoleChanges(options = {}) {
    try {
      const { page = 1, limit = 50, role = null, changedBy = null } = options;
      const skip = (page - 1) * limit;

      const query = {};
      if (role) query.newRole = role;
      if (changedBy) query.changedBy = changedBy;

      const [roleChanges, total] = await Promise.all([
        RoleChange.find(query)
          .populate("userId", "email role")
          .populate("changedBy", "email role")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        RoleChange.countDocuments(query),
      ]);

      return createPaginationResponse(roleChanges, total, page, limit);
    } catch (error) {
      logError(error, "RoleService.getAllRoleChanges");
      throw error;
    }
  }

  // Получение кандидатов на роль эксперта
  async getExpertCandidates(options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        minQuestions = 5,
        minDaysActive = 30,
      } = options;
      const skip = (page - 1) * limit;

      // Дата для проверки активности
      const minActiveDate = new Date();
      minActiveDate.setDate(minActiveDate.getDate() - minDaysActive);

      const [candidates, total] = await Promise.all([
        User.find({
          role: USER_ROLES.USER,
          isActive: true,
          isBanned: false,
          totalQuestions: { $gte: minQuestions },
          createdAt: { $lte: minActiveDate },
        })
          .select("email totalQuestions totalAnswers createdAt lastLoginAt")
          .sort({ totalQuestions: -1, createdAt: 1 })
          .skip(skip)
          .limit(limit),
        User.countDocuments({
          role: USER_ROLES.USER,
          isActive: true,
          isBanned: false,
          totalQuestions: { $gte: minQuestions },
          createdAt: { $lte: minActiveDate },
        }),
      ]);

      return createPaginationResponse(candidates, total, page, limit);
    } catch (error) {
      logError(error, "RoleService.getExpertCandidates");
      throw error;
    }
  }

  // Массовое назначение роли эксперта
  async promoteUsersToExpert(userIds, changedBy, reason = "Mass promotion") {
    try {
      const results = [];
      const errors = [];

      for (const userId of userIds) {
        try {
          const result = await this.changeUserRole(
            userId,
            USER_ROLES.EXPERT,
            changedBy,
            reason
          );
          results.push(result);
        } catch (error) {
          errors.push({ userId, error: error.message });
        }
      }

      logUserAction(
        changedBy,
        "MASS_ROLE_PROMOTION",
        `Promoted ${results.length} users to expert. ${errors.length} errors.`
      );

      return {
        successful: results,
        errors,
        summary: {
          total: userIds.length,
          successful: results.length,
          failed: errors.length,
        },
      };
    } catch (error) {
      logError(error, "RoleService.promoteUsersToExpert");
      throw error;
    }
  }

  // Статистика по ролям
  async getRoleStatistics() {
    try {
      const [userStats, recentChanges, topAdmins] = await Promise.all([
        User.aggregate([
          {
            $group: {
              _id: "$role",
              count: { $sum: 1 },
              active: { $sum: { $cond: ["$isActive", 1, 0] } },
              banned: { $sum: { $cond: ["$isBanned", 1, 0] } },
            },
          },
        ]),

        RoleChange.countDocuments({
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        }),

        RoleChange.aggregate([
          {
            $group: {
              _id: "$changedBy",
              changes: { $sum: 1 },
            },
          },
          { $sort: { changes: -1 } },
          { $limit: 5 },
          {
            $lookup: {
              from: "users",
              localField: "_id",
              foreignField: "_id",
              as: "admin",
              pipeline: [{ $project: { email: 1, role: 1 } }],
            },
          },
          { $unwind: "$admin" },
        ]),
      ]);

      return {
        byRole: userStats.reduce((acc, stat) => {
          acc[stat._id] = stat;
          return acc;
        }, {}),
        recentChanges,
        topAdmins,
      };
    } catch (error) {
      logError(error, "RoleService.getRoleStatistics");
      throw error;
    }
  }

  // Проверка возможности изменения роли
  async canChangeRole(targetUserId, newRole, adminId) {
    try {
      const [targetUser, admin] = await Promise.all([
        User.findById(targetUserId),
        User.findById(adminId),
      ]);

      if (!targetUser) {
        return { canChange: false, reason: "Cieľový používateľ nebol nájdený" };
      }

      if (!admin || admin.role !== USER_ROLES.ADMIN) {
        return { canChange: false, reason: "Iba administrátori môžu meniť roly" };
      }

      // Нельзя изменить свою собственную роль
      if (targetUserId === adminId) {
        return { canChange: false, reason: "Nemôžete zmeniť svoju vlastnú rolu" };
      }

      // Нельзя назначить роль выше своей
      const roleHierarchy = {
        [USER_ROLES.USER]: 1,
        [USER_ROLES.EXPERT]: 2,
        [USER_ROLES.ADMIN]: 3,
      };

      const adminLevel = roleHierarchy[admin.role] || 0;
      const targetLevel = roleHierarchy[newRole] || 0;

      if (targetLevel > adminLevel) {
        return {
          canChange: false,
          reason: "Nemôžete priradiť rolu vyššiu ako je vaša vlastná",
        };
      }

      return { canChange: true };
    } catch (error) {
      logError(error, "RoleService.canChangeRole");
      return { canChange: false, reason: "Interná chyba" };
    }
  }

  // Получение переходов ролей
  async getRoleTransitions() {
    try {
      const transitions = await RoleChange.aggregate([
        {
          $group: {
            _id: {
              from: "$oldRole",
              to: "$newRole",
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]);

      return transitions.map((t) => ({
        from: t._id.from,
        to: t._id.to,
        count: t.count,
      }));
    } catch (error) {
      logError(error, "RoleService.getRoleTransitions");
      throw error;
    }
  }
}

export default new RoleService();
