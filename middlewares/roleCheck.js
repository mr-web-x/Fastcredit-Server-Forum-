// middlewares/roleCheck.js
import { USER_ROLES, ERROR_MESSAGES } from "../utils/constants.js";
import { formatResponse } from "../utils/helpers.js";
import { logSecurityEvent } from "./logger.js";

// Проверка конкретной роли
export const requireRole = (role) => {
  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json(formatResponse(false, null, ERROR_MESSAGES.UNAUTHORIZED));
    }

    if (req.user.role !== role) {
      logSecurityEvent(
        "ROLE_ACCESS_DENIED",
        `User with role ${req.user.role} tried to access ${role} only resource`,
        req.user._id,
        req.ip
      );

      return res
        .status(403)
        .json(
          formatResponse(
            false,
            null,
            `Доступ разрешен только для роли: ${role}`
          )
        );
    }

    next();
  };
};

// Проверка множественных ролей (любая из разрешенных)
export const requireAnyRole = (roles) => {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json(formatResponse(false, null, ERROR_MESSAGES.UNAUTHORIZED));
    }

    if (!allowedRoles.includes(req.user.role)) {
      logSecurityEvent(
        "ROLE_ACCESS_DENIED",
        `User with role ${
          req.user.role
        } tried to access resource requiring: ${allowedRoles.join(", ")}`,
        req.user._id,
        req.ip
      );

      return res
        .status(403)
        .json(
          formatResponse(
            false,
            null,
            `Доступ разрешен только для ролей: ${allowedRoles.join(", ")}`
          )
        );
    }

    next();
  };
};

// Проверка что пользователь обычный юзер
export const requireUser = requireRole(USER_ROLES.USER);

// Проверка что пользователь эксперт
export const requireExpert = requireRole(USER_ROLES.EXPERT);

// Проверка что пользователь админ
export const requireAdmin = requireRole(USER_ROLES.ADMIN);

// Проверка что пользователь эксперт или админ (может отвечать на вопросы)
export const requireExpertOrAdmin = requireAnyRole([
  USER_ROLES.EXPERT,
  USER_ROLES.ADMIN,
]);

// Проверка что пользователь может модерировать (только админ)
export const requireModerator = (req, res, next) => {
  if (!req.user) {
    return res
      .status(401)
      .json(formatResponse(false, null, ERROR_MESSAGES.UNAUTHORIZED));
  }

  if (!req.user.canModerate) {
    logSecurityEvent(
      "MODERATION_ACCESS_DENIED",
      `User ${req.user._id} with role ${req.user.role} tried to access moderation`,
      req.user._id,
      req.ip
    );

    return res
      .status(403)
      .json(formatResponse(false, null, "Недостаточно прав для модерации"));
  }

  next();
};

// Проверка владельца ресурса или админа
export const requireOwnerOrAdmin = (getOwnerId) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json(formatResponse(false, null, ERROR_MESSAGES.UNAUTHORIZED));
    }

    // Админы могут все
    if (req.user.role === USER_ROLES.ADMIN) {
      return next();
    }

    try {
      let ownerId;

      // getOwnerId может быть функцией или строкой (поле из req)
      if (typeof getOwnerId === "function") {
        ownerId = await getOwnerId(req);
      } else if (typeof getOwnerId === "string") {
        ownerId = req[getOwnerId]; // например, req.resource.author
      } else {
        throw new Error("Invalid getOwnerId parameter");
      }

      if (!ownerId || ownerId.toString() !== req.user._id.toString()) {
        logSecurityEvent(
          "OWNERSHIP_ACCESS_DENIED",
          `User ${req.user._id} tried to access resource owned by ${ownerId}`,
          req.user._id,
          req.ip
        );

        return res
          .status(403)
          .json(
            formatResponse(
              false,
              null,
              "Вы можете изменять только свой контент"
            )
          );
      }

      next();
    } catch (error) {
      console.error("Owner check error:", error);
      return res
        .status(500)
        .json(
          formatResponse(false, null, ERROR_MESSAGES.INTERNAL_SERVER_ERROR)
        );
    }
  };
};

// Проверка автора вопроса или админа (для принятия ответов)
export const requireQuestionAuthorOrAdmin = (getQuestionAuthor) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json(formatResponse(false, null, ERROR_MESSAGES.UNAUTHORIZED));
    }

    // Админы могут все
    if (req.user.role === USER_ROLES.ADMIN) {
      return next();
    }

    try {
      const authorId = await getQuestionAuthor(req);

      if (!authorId || authorId.toString() !== req.user._id.toString()) {
        return res
          .status(403)
          .json(
            formatResponse(
              false,
              null,
              "Только автор вопроса или админ может принять ответ"
            )
          );
      }

      next();
    } catch (error) {
      console.error("Question author check error:", error);
      return res
        .status(500)
        .json(
          formatResponse(false, null, ERROR_MESSAGES.INTERNAL_SERVER_ERROR)
        );
    }
  };
};

// Проверка минимального уровня роли (иерархия ролей)
export const requireMinRole = (minRole) => {
  const roleHierarchy = {
    [USER_ROLES.USER]: 1,
    [USER_ROLES.EXPERT]: 2,
    [USER_ROLES.ADMIN]: 3,
  };

  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json(formatResponse(false, null, ERROR_MESSAGES.UNAUTHORIZED));
    }

    const userLevel = roleHierarchy[req.user.role] || 0;
    const requiredLevel = roleHierarchy[minRole] || 0;

    if (userLevel < requiredLevel) {
      logSecurityEvent(
        "MIN_ROLE_ACCESS_DENIED",
        `User with role ${req.user.role} (level ${userLevel}) tried to access resource requiring min level ${requiredLevel}`,
        req.user._id,
        req.ip
      );

      return res
        .status(403)
        .json(
          formatResponse(false, null, `Требуется минимальная роль: ${minRole}`)
        );
    }

    next();
  };
};

// Проверка что пользователь может отвечать на вопросы
export const requireCanAnswer = (req, res, next) => {
  if (!req.user) {
    return res
      .status(401)
      .json(formatResponse(false, null, ERROR_MESSAGES.UNAUTHORIZED));
  }

  if (!req.user.canAnswer) {
    let message = "Недостаточно прав для ответа на вопросы";

    if (req.user.role === USER_ROLES.USER) {
      message = "Только эксперты и админы могут отвечать на вопросы";
    } else if (!req.user.isActive) {
      message = "Аккаунт деактивирован";
    } else if (req.user.isBannedCurrently()) {
      message = "Аккаунт заблокирован";
    }

    return res.status(403).json(
      formatResponse(false, null, message, {
        role: req.user.role,
        isActive: req.user.isActive,
        isBanned: req.user.isBanned,
      })
    );
  }

  next();
};

// Проверка активности пользователя и отсутствия бана
export const requireActiveUser = (req, res, next) => {
  if (!req.user) {
    return res
      .status(401)
      .json(formatResponse(false, null, ERROR_MESSAGES.UNAUTHORIZED));
  }

  if (!req.user.canAccessFeatures()) {
    let message = "Действие запрещено";

    if (!req.user.isActive) {
      message = "Аккаунт деактивирован";
    } else if (req.user.isBannedCurrently()) {
      const until = req.user.bannedUntil
        ? ` до ${req.user.bannedUntil.toLocaleDateString()}`
        : " навсегда";
      message = `Аккаунт заблокирован${until}. Причина: ${
        req.user.bannedReason || "не указана"
      }`;
    }

    return res.status(403).json(formatResponse(false, null, message));
  }

  next();
};

// Middleware для получения информации о правах пользователя (не блокирует)
export const attachUserPermissions = (req, res, next) => {
  if (req.user) {
    req.userPermissions = {
      canAnswer: req.user.canAnswer,
      canModerate: req.user.canModerate,
      isExpert: req.user.isExpert,
      isAdmin: req.user.isAdmin,
      canPerformAction: req.user.canAccessFeatures(),
      role: req.user.role,
    };
  } else {
    req.userPermissions = {
      canAnswer: false,
      canModerate: false,
      isExpert: false,
      isAdmin: false,
      canPerformAction: false,
      role: null,
    };
  }

  next();
};

export default {
  requireRole,
  requireAnyRole,
  requireUser,
  requireExpert,
  requireAdmin,
  requireExpertOrAdmin,
  requireModerator,
  requireOwnerOrAdmin,
  requireQuestionAuthorOrAdmin,
  requireMinRole,
  requireCanAnswer,
  requireActiveUser,
  attachUserPermissions,
};
