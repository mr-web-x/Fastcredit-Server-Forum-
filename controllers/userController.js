// controllers/userController.js
import userService from "../services/userService.js";
import roleService from "../services/roleService.js";
import notificationService from "../services/notificationService.js";
import {
  formatResponse,
  getPaginationData,
  isValidObjectId,
} from "../utils/helpers.js";
import {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  USER_ROLES,
} from "../utils/constants.js";
import { asyncHandler } from "../middlewares/errorHandler.js";
import { logUserAction } from "../middlewares/logger.js";

class UserController {
  // Получение списка пользователей (только админы)
  getUsers = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);
    const {
      role,
      isActive,
      isBanned,
      search,
      sortBy = "createdAt",
      sortOrder = -1,
    } = req.query;

    const options = {
      page,
      limit,
      role,
      isActive:
        isActive === "true" ? true : isActive === "false" ? false : null,
      isBanned:
        isBanned === "true" ? true : isBanned === "false" ? false : null,
      search,
      sortBy,
      sortOrder: parseInt(sortOrder),
    };

    const users = await userService.getUsers(options);

    res.json(formatResponse(true, users, "Список пользователей получен"));
  });

  // Получение конкретного пользователя
  getUser = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID пользователя", {
          type: "VALIDATION_ERROR",
          field: "id",
        })
      );
    }

    // Обычные пользователи могут видеть только свой профиль
    if (id !== req.user._id.toString() && req.user.role !== "admin") {
      return res
        .status(403)
        .json(formatResponse(false, null, ERROR_MESSAGES.FORBIDDEN));
    }

    const user = await userService.getUserById(id, req.user.role === "admin");

    res.json(formatResponse(true, user, "Информация о пользователе получена"));
  });

  // Получение активности пользователя (вопросы, ответы, комментарии)
  getUserActivity = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { page, limit } = getPaginationData(req);

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID пользователя", {
          type: "VALIDATION_ERROR",
          field: "id",
        })
      );
    }

    // Обычные пользователи могут видеть только свою активность
    if (id !== req.user._id.toString() && req.user.role !== "admin") {
      return res
        .status(403)
        .json(formatResponse(false, null, ERROR_MESSAGES.FORBIDDEN));
    }

    const options = { page, limit };
    const activity = await userService.getUserActivity(id, options);

    res.json(
      formatResponse(true, activity, "Активность пользователя получена")
    );
  });

  // Обновление профиля пользователя
  updateProfile = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { bio, avatar } = req.body;

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID пользователя", {
          type: "VALIDATION_ERROR",
          field: "id",
        })
      );
    }

    // Обычные пользователи могут редактировать только свой профиль
    if (id !== req.user._id.toString() && req.user.role !== "admin") {
      return res
        .status(403)
        .json(formatResponse(false, null, ERROR_MESSAGES.FORBIDDEN));
    }

    // Валидация данных
    if (bio && bio.length > 500) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Биография не может превышать 500 символов",
          {
            type: "VALIDATION_ERROR",
            field: "bio",
          }
        )
      );
    }

    if (avatar && !avatar.match(/^https?:\/\/.+/)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат URL аватара", {
          type: "VALIDATION_ERROR",
          field: "avatar",
        })
      );
    }

    const updateData = {};
    if (bio !== undefined) updateData.bio = bio;
    if (avatar !== undefined) updateData.avatar = avatar;

    if (Object.keys(updateData).length === 0) {
      return res
        .status(400)
        .json(formatResponse(false, null, "Нет данных для обновления"));
    }

    const updatedUser = await userService.updateProfile(
      id,
      updateData,
      req.user
    );

    res.json(
      formatResponse(true, updatedUser, SUCCESS_MESSAGES.PROFILE_UPDATED)
    );
  });

  // Изменение роли пользователя (только админы)
  changeUserRole = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { role, reason } = req.body;
    const adminId = req.user._id;

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID пользователя", {
          type: "VALIDATION_ERROR",
          field: "id",
        })
      );
    }

    // Валидация роли
    if (!Object.values(USER_ROLES).includes(role)) {
      return res.status(400).json(
        formatResponse(false, null, "Недопустимая роль пользователя", {
          type: "VALIDATION_ERROR",
          field: "role",
          allowedValues: Object.values(USER_ROLES),
        })
      );
    }

    // Проверка возможности изменения роли
    const canChangeRole = await roleService.canChangeRole(id, role, adminId);
    if (!canChangeRole.canChange) {
      return res.status(403).json(
        formatResponse(false, null, canChangeRole.reason, {
          type: "ROLE_CHANGE_FORBIDDEN",
        })
      );
    }

    const result = await roleService.changeUserRole(id, role, adminId, reason);

    // Уведомляем пользователя об изменении роли
    try {
      await notificationService.notifyUserAboutRoleChange(
        id,
        result.roleChange.oldRole,
        result.roleChange.newRole,
        adminId
      );
    } catch (notificationError) {
      console.warn(
        "Failed to notify user about role change:",
        notificationError.message
      );
    }

    res.json(formatResponse(true, result, SUCCESS_MESSAGES.ROLE_CHANGED));
  });

  // Бан пользователя (только админы)
  banUser = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reason, duration } = req.body; // duration в днях, если не указан - перманентный бан
    const adminId = req.user._id;

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID пользователя", {
          type: "VALIDATION_ERROR",
          field: "id",
        })
      );
    }

    // Валидация причины
    if (!reason || reason.trim().length < 10) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Причина бана должна содержать минимум 10 символов",
          {
            type: "VALIDATION_ERROR",
            field: "reason",
          }
        )
      );
    }

    // Нельзя банить самого себя
    if (id === adminId.toString()) {
      return res.status(400).json(
        formatResponse(false, null, "Нельзя забанить самого себя", {
          type: "SELF_BAN_FORBIDDEN",
        })
      );
    }

    const updateData = {
      isBanned: true,
      bannedReason: reason.trim(),
      bannedUntil: duration
        ? new Date(Date.now() + duration * 24 * 60 * 60 * 1000)
        : null,
    };

    const bannedUser = await userService.updateProfile(
      id,
      updateData,
      req.user
    );

    // Уведомляем пользователя о бане
    try {
      await notificationService.notifyUserAboutBan(
        id,
        reason.trim(),
        updateData.bannedUntil,
        adminId
      );
    } catch (notificationError) {
      console.warn(
        "Failed to notify user about ban:",
        notificationError.message
      );
    }

    logUserAction(
      adminId,
      "USER_BANNED",
      `Banned user ${id} for reason: ${reason.trim()}`
    );

    res.json(formatResponse(true, bannedUser, "Пользователь заблокирован"));
  });

  // Разбан пользователя (только админы)
  unbanUser = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const adminId = req.user._id;

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID пользователя", {
          type: "VALIDATION_ERROR",
          field: "id",
        })
      );
    }

    const updateData = {
      isBanned: false,
      bannedReason: null,
      bannedUntil: null,
    };

    const unbannedUser = await userService.updateProfile(
      id,
      updateData,
      req.user
    );

    logUserAction(adminId, "USER_UNBANNED", `Unbanned user ${id}`);

    res.json(formatResponse(true, unbannedUser, "Пользователь разблокирован"));
  });

  // Поиск пользователей
  searchUsers = asyncHandler(async (req, res) => {
    const { q: query } = req.query;
    const { page, limit } = getPaginationData(req);
    const { role } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Поисковый запрос должен содержать минимум 2 символа",
          {
            type: "VALIDATION_ERROR",
            field: "query",
          }
        )
      );
    }

    const options = {
      page,
      limit,
      role,
    };

    const results = await userService.searchUsers(query.trim(), options);

    res.json(
      formatResponse(true, results, "Результаты поиска пользователей получены")
    );
  });

  // Получение статистики пользователей (только админы)
  getUserStatistics = asyncHandler(async (req, res) => {
    const statistics = await userService.getUserStatistics();

    res.json(
      formatResponse(true, statistics, "Статистика пользователей получена")
    );
  });

  // Получение кандидатов на роль эксперта (только админы)
  getExpertCandidates = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);
    const { minQuestions = 5, minDaysActive = 30 } = req.query;

    const options = {
      page,
      limit,
      minQuestions: parseInt(minQuestions),
      minDaysActive: parseInt(minDaysActive),
    };

    const candidates = await roleService.getExpertCandidates(options);

    res.json(formatResponse(true, candidates, "Кандидаты в эксперты получены"));
  });

  // Массовое назначение роли эксперта (только админы)
  promoteUsersToExpert = asyncHandler(async (req, res) => {
    const { userIds, reason = "Mass promotion" } = req.body;
    const adminId = req.user._id;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json(
        formatResponse(false, null, "Список ID пользователей обязателен", {
          type: "VALIDATION_ERROR",
          field: "userIds",
        })
      );
    }

    if (userIds.length > 20) {
      return res.status(400).json(
        formatResponse(false, null, "Максимум 20 пользователей за раз", {
          type: "VALIDATION_ERROR",
          field: "userIds",
        })
      );
    }

    // Валидация всех ID
    for (const userId of userIds) {
      if (!isValidObjectId(userId)) {
        return res.status(400).json(
          formatResponse(false, null, `Неверный формат ID: ${userId}`, {
            type: "VALIDATION_ERROR",
            field: "userIds",
          })
        );
      }
    }

    const result = await roleService.promoteUsersToExpert(
      userIds,
      adminId,
      reason
    );

    res.json(
      formatResponse(
        true,
        result,
        `Массовое назначение завершено: ${result.summary.successful} успешно, ${result.summary.failed} ошибок`
      )
    );
  });

  // Получение истории изменений ролей пользователя
  getUserRoleHistory = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { page, limit } = getPaginationData(req);

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID пользователя", {
          type: "VALIDATION_ERROR",
          field: "id",
        })
      );
    }

    const options = { page, limit };
    const history = await roleService.getUserRoleHistory(id, options);

    res.json(formatResponse(true, history, "История изменений ролей получена"));
  });
}

export default new UserController();
