// middlewares/banCheck.js
import { formatResponse } from "../utils/helpers.js";
import { ERROR_MESSAGES } from "../utils/constants.js";
import { logSecurityEvent } from "./logger.js";

// Middleware для проверки блокировки пользователя
export const checkUserBan = (req, res, next) => {
  // Если пользователь не авторизован, пропускаем проверку
  if (!req.user) {
    return next();
  }

  // Проверяем активность аккаунта
  if (!req.user.isActive) {
    logSecurityEvent(
      "INACTIVE_USER_ACCESS",
      "Inactive user attempted to access resource",
      req.user._id,
      req.ip
    );

    return res.status(403).json(
      formatResponse(
        false,
        null,
        "Аккаунт деактивирован. Обратитесь к администратору.",
        {
          type: "ACCOUNT_DEACTIVATED",
          userId: req.user._id,
        }
      )
    );
  }

  // Проверяем текущую блокировку
  if (req.user.isBannedCurrently()) {
    const banInfo = {
      isBanned: true,
      reason: req.user.bannedReason,
      bannedUntil: req.user.bannedUntil,
      isPermanent: !req.user.bannedUntil,
    };

    let banMessage;
    if (banInfo.isPermanent) {
      banMessage = `Аккаунт заблокирован навсегда. Причина: ${banInfo.reason}`;
    } else {
      const until = banInfo.bannedUntil.toLocaleDateString("sk-SK", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      banMessage = `Аккаунт заблокирован до ${until}. Причина: ${banInfo.reason}`;
    }

    logSecurityEvent(
      "BANNED_USER_ACCESS",
      `Banned user attempted to access resource: ${banMessage}`,
      req.user._id,
      req.ip
    );

    return res.status(403).json(
      formatResponse(false, null, banMessage, {
        type: "USER_BANNED",
        ...banInfo,
      })
    );
  }

  next();
};

// Middleware для проверки возможности выполнения действия
export const checkUserCanPerformAction = (req, res, next) => {
  if (!req.user) {
    return res
      .status(401)
      .json(formatResponse(false, null, ERROR_MESSAGES.UNAUTHORIZED));
  }

  if (!req.user.canAccessFeatures()) {
    const reason = !req.user.isActive
      ? "Аккаунт деактивирован"
      : "Аккаунт заблокирован";

    return res.status(403).json(
      formatResponse(false, null, `${reason}. Действие запрещено.`, {
        type: "ACTION_FORBIDDEN",
        isActive: req.user.isActive,
        isBanned: req.user.isBanned,
        bannedUntil: req.user.bannedUntil,
      })
    );
  }

  next();
};

// Middleware для проверки возможности отвечать (только для экспертов)
export const checkUserCanAnswer = (req, res, next) => {
  if (!req.user) {
    return res
      .status(401)
      .json(formatResponse(false, null, ERROR_MESSAGES.UNAUTHORIZED));
  }

  if (!req.user.canAnswer) {
    let message;
    if (!req.user.isExpert) {
      message = "Только эксперты могут отвечать на вопросы";
    } else if (!req.user.isActive) {
      message = "Аккаунт деактивирован";
    } else if (req.user.isBannedCurrently()) {
      message = "Аккаунт заблокирован";
    } else {
      message = "Недостаточно прав для ответа на вопросы";
    }

    return res.status(403).json(
      formatResponse(false, null, message, {
        type: "ANSWER_FORBIDDEN",
        isExpert: req.user.isExpert,
        isActive: req.user.isActive,
        isBanned: req.user.isBanned,
      })
    );
  }

  next();
};

// Middleware для проверки возможности модерировать (только админы)
export const checkUserCanModerate = (req, res, next) => {
  if (!req.user) {
    return res
      .status(401)
      .json(formatResponse(false, null, ERROR_MESSAGES.UNAUTHORIZED));
  }


  if (!req.user.canModerate) {
    let message;
    if (!req.user.isAdmin) {
      message = "Только администраторы могут модерировать контент";
    } else if (!req.user.isActive) {
      message = "Аккаунт деактивирован";
    } else if (req.user.isBannedCurrently()) {
      message = "Аккаунт заблокирован";
    } else {
      message = "Недостаточно прав для модерации";
    }

    return res.status(403).json(
      formatResponse(false, null, message, {
        type: "MODERATION_FORBIDDEN",
        isAdmin: req.user.isAdmin,
        isActive: req.user.isActive,
        isBanned: req.user.isBanned,
      })
    );
  }

  next();
};

// Middleware для автоматической разблокировки истекших временных банов
export const autoUnbanExpiredUsers = async (req, res, next) => {
  try {
    if (req.user && req.user.isBanned && req.user.bannedUntil) {
      const now = new Date();

      // Если время бана истекло
      if (now >= req.user.bannedUntil) {
        req.user.isBanned = false;
        req.user.bannedUntil = null;
        req.user.bannedReason = null;

        await req.user.save({ validateBeforeSave: false });

        logSecurityEvent(
          "USER_AUTO_UNBANNED",
          "User automatically unbanned after ban expiration",
          req.user._id,
          req.ip
        );

        // Обновляем объект пользователя в запросе
        req.user = await req.user.constructor.findById(req.user._id);
      }
    }

    next();
  } catch (error) {
    console.error("Auto unban error:", error);
    // При ошибке продолжаем выполнение
    next();
  }
};

export default {
  checkUserBan,
  checkUserCanPerformAction,
  checkUserCanAnswer,
  checkUserCanModerate,
  autoUnbanExpiredUsers,
};
