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

    res.json(formatResponse(true, users, "Zoznam používateľov bol získaný"));
  });

  // Получение конкретного пользователя
  getUser = asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Nesprávny formát ID používateľa", {
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

    res.json(
      formatResponse(true, user, "Informácie o používateľovi boli získané")
    );
  });

  // Получение активности пользователя (вопросы, ответы, комментарии)
  getUserActivity = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { page, limit } = getPaginationData(req);

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Nesprávny formát ID používateľa", {
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
      formatResponse(true, activity, "Aktivita používateľa bola získaná")
    );
  });

  // Обновление профиля пользователя
  updateProfile = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { bio, avatar } = req.body;

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Nesprávny formát ID používateľa", {
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
        formatResponse(false, null, "Biografia nemôže presiahnuť 500 znakov", {
          type: "VALIDATION_ERROR",
          field: "bio",
        })
      );
    }

    if (avatar && !avatar.match(/^https?:\/\/.+/)) {
      return res.status(400).json(
        formatResponse(false, null, "Nesprávny formát URL pre avatar", {
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
        .json(formatResponse(false, null, "Žiadne údaje na aktualizáciu"));
    }

    const updatedUser = await userService.updateProfile(
      id,
      updateData,
      req.user
    );

    res.json(
      formatResponse(
        true,
        updatedUser,
        SUCCESS_MESSAGES.PROFILE_UPDATED || "Profil bol aktualizovaný"
      )
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
        formatResponse(false, null, "Nesprávny formát ID používateľa", {
          type: "VALIDATION_ERROR",
          field: "id",
        })
      );
    }

    // Валидация роли
    if (!Object.values(USER_ROLES).includes(role)) {
      return res.status(400).json(
        formatResponse(false, null, "Neplatná rola používateľa", {
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

    res.json(
      formatResponse(
        true,
        result,
        SUCCESS_MESSAGES.ROLE_CHANGED || "Rola používateľa bola zmenená"
      )
    );
  });

  // Бан пользователя (только админы)
  banUser = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reason, duration } = req.body; // duration в днях, если не указан - перманентный бан
    const adminId = req.user._id;

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Nesprávny formát ID používateľa", {
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
          "Dôvod blokovania musí obsahovať aspoň 10 znakov",
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
        formatResponse(false, null, "Nemôžete zablokovať sami seba", {
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

    res.json(formatResponse(true, bannedUser, "Používateľ bol zablokovaný"));
  });

  // Разбан пользователя (только админы)
  unbanUser = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const adminId = req.user._id;

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Nesprávny formát ID používateľa", {
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

    res.json(formatResponse(true, unbannedUser, "Používateľ bol odblokovaný"));
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
          "Vyhľadávací dotaz musí obsahovať aspoň 2 znaky",
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
      formatResponse(
        true,
        results,
        "Výsledky vyhľadávania používateľov boli získané"
      )
    );
  });

  // Получение статистики пользователей (только админы)
  getUserStatistics = asyncHandler(async (req, res) => {
    const statistics = await userService.getUserStatistics();

    res.json(
      formatResponse(true, statistics, "Štatistika používateľov bola získaná")
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

    res.json(
      formatResponse(true, candidates, "Kandidáti na expertov boli získaní")
    );
  });

  // Массовое назначение роли эксперта (только админы)
  promoteUsersToExpert = asyncHandler(async (req, res) => {
    const { userIds, reason = "Mass promotion" } = req.body;
    const adminId = req.user._id;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json(
        formatResponse(false, null, "Zoznam ID používateľov je povinný", {
          type: "VALIDATION_ERROR",
          field: "userIds",
        })
      );
    }

    if (userIds.length > 20) {
      return res.status(400).json(
        formatResponse(false, null, "Maximálne 20 používateľov naraz", {
          type: "VALIDATION_ERROR",
          field: "userIds",
        })
      );
    }

    // Валидация всех ID
    for (const userId of userIds) {
      if (!isValidObjectId(userId)) {
        return res.status(400).json(
          formatResponse(false, null, `Nesprávny formát ID: ${userId}`, {
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
        `Hromadné povýšenie dokončené: ${result.summary.successful} úspešných, ${result.summary.failed} chýb`
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
        formatResponse(false, null, "Nesprávny formát ID používateľa", {
          type: "VALIDATION_ERROR",
          field: "id",
        })
      );
    }

    const options = { page, limit };
    const history = await roleService.getUserRoleHistory(id, options);

    res.json(formatResponse(true, history, "História zmien rolí bola získaná"));
  });
}

export default new UserController();
