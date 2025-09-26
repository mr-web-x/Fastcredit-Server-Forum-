// middlewares/auth.js
import jwt from "jsonwebtoken";
import config from "../config/index.js";
import User from "../models/User.js";
import { formatResponse } from "../utils/helpers.js";
import { ERROR_MESSAGES } from "../utils/constants.js";
import { logSecurityEvent } from "./logger.js";
import cryptoService from "../services/cryptoService.js";

// Извлечение токена из заголовка Authorization
const extractToken = (req) => {
  // Сначала проверяем Authorization header
  const authHeader = req.headers.authorization;

  if (authHeader) {
    if (authHeader.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }
    return authHeader;
  }

  // Парсим cookies вручную если req.cookies недоступен
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(";").reduce((acc, cookie) => {
      const [name, value] = cookie.trim().split("=");
      acc[name] = value;
      return acc;
    }, {});

    if (cookies.fc_jwt) {
      return cookies.fc_jwt;
    }
  }

  return null;
};

// Верификация JWT токена
const verifyToken = (token) => {
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new Error("TOKEN_EXPIRED");
    }
    if (error.name === "JsonWebTokenError") {
      throw new Error("INVALID_TOKEN");
    }
    throw error;
  }
};

// Основной middleware для проверки авторизации
export const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    console.log(req.body);
    if (!token) {
      logSecurityEvent(
        "UNAUTHORIZED_ACCESS",
        "No token provided",
        null,
        req.ip
      );
      return res
        .status(401)
        .json(formatResponse(false, null, "Neautorizovaný prístup"));
    }

    const decoded = verifyToken(token);

    // Получаем пользователя из базы данных
    const user = await User.findById(decoded.userId || decoded.id).select(
      "-__v"
    );

    await cryptoService.smartDecrypt(user);

    if (!user) {
      logSecurityEvent(
        "INVALID_TOKEN",
        "User not found for token",
        decoded.userId,
        req.ip
      );
      return res
        .status(401)
        .json(formatResponse(false, null, "Neplatný token"));
    }

    // Проверяем активность пользователя
    if (!user.isActive) {
      logSecurityEvent(
        "UNAUTHORIZED_ACCESS",
        "Inactive user attempt",
        user._id,
        req.ip
      );
      return res
        .status(401)
        .json(formatResponse(false, null, "Účet je deaktivovaný"));
    }

    // Проверяем блокировку
    if (user.isBannedCurrently()) {
      const banMessage = user.bannedUntil
        ? `Účet je zablokovaný do ${user.bannedUntil.toLocaleDateString()}`
        : "Účet je zablokovaný";

      logSecurityEvent("BANNED_USER_ATTEMPT", banMessage, user._id, req.ip);
      return res.status(403).json(formatResponse(false, null, banMessage));
    }

    // Добавляем пользователя в объект запроса
    req.user = user;
    req.token = token;

    // Обновляем время последнего входа (не чаще раза в 5 минут)
    const now = new Date();
    if (!user.lastLoginAt || now - user.lastLoginAt > 300000) {
      user.lastLoginAt = now;
      await user.save({ validateBeforeSave: false });
    }

    next();
  } catch (error) {
    if (error.message === "TOKEN_EXPIRED") {
      return res
        .status(401)
        .json(
          formatResponse(false, null, "Token vypršal. Prosím, prihláste sa znova")
        );
    }

    if (error.message === "INVALID_TOKEN") {
      logSecurityEvent("INVALID_TOKEN", "Invalid token format", null, req.ip);
      return res
        .status(401)
        .json(formatResponse(false, null, "Neplatný token"));
    }

    console.error("Auth middleware error:", error);
    return res
      .status(500)
      .json(formatResponse(false, null, "Interná chyba servera"));
  }
};

// Middleware для опциональной авторизации (не требует токен)
export const optionalAuth = async (req, res, next) => {
  try {
    const token = extractToken(req);

    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = verifyToken(token);
    const user = await User.findById(decoded.userId || decoded.id).select(
      "-__v"
    );
    await cryptoService.smartDecrypt(user);

    if (user && user.isActive && !user.isBannedCurrently()) {
      req.user = user;
      req.token = token;
    } else {
      req.user = null;
    }

    next();
  } catch (error) {
    // При опциональной авторизации игнорируем ошибки токена
    req.user = null;
    next();
  }
};

// Проверка роли пользователя
export const requireRole = (roles) => {
  // roles может быть строкой или массивом строк
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json(formatResponse(false, null, "Neautorizovaný prístup"));
    }

    if (!allowedRoles.includes(req.user.role)) {
      logSecurityEvent(
        "ROLE_ESCALATION_ATTEMPT",
        `User with role ${req.user.role} tried to access ${allowedRoles.join(
          ", "
        )} only resource`,
        req.user._id,
        req.ip
      );

      return res
        .status(403)
        .json(formatResponse(false, null, "Zakázané"));
    }

    next();
  };
};

// Проверка что пользователь является экспертом или админом
export const requireExpert = requireRole(["expert", "admin"]);

// Проверка что пользователь является админом
export const requireAdmin = requireRole(["admin"]);

// Проверка что пользователь может модерировать контент
export const requireModerator = (req, res, next) => {
  if (!req.user) {
    return res
      .status(401)
      .json(formatResponse(false, null, "Neautorizovaný prístup"));
  }

  if (!req.user.canModerate) {
    return res
      .status(403)
      .json(formatResponse(false, null, "Zakázané"));
  }

  next();
};

// Проверка владельца ресурса или админа
export const requireOwnerOrAdmin = (getResourceOwner) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res
        .status(401)
        .json(formatResponse(false, null, "Neautorizovaný prístup"));
    }

    // Админы могут все
    if (req.user.role === "admin") {
      return next();
    }

    try {
      // Получаем ID владельца ресурса
      const ownerId = await getResourceOwner(req);

      if (!ownerId || ownerId.toString() !== req.user._id.toString()) {
        return res
          .status(403)
          .json(
            formatResponse(
              false,
              null,
              "Prístup zamietnutý. Môžete upravovať iba svoj obsah"
            )
          );
      }

      next();
    } catch (error) {
      console.error("Owner check error:", error);
      return res
        .status(500)
        .json(
          formatResponse(false, null, "Interná chyba servera")
        );
    }
  };
};

export default {
  authenticate,
  optionalAuth,
  requireRole,
  requireExpert,
  requireAdmin,
  requireModerator,
  requireOwnerOrAdmin,
};
