// middlewares/rateLimit.js
import { rateLimit } from "express-rate-limit";
import RateLimit from "../models/RateLimit.js";
import config from "../config/index.js";
import { formatResponse, getClientIP } from "../utils/helpers.js";
import { RATE_LIMIT_ACTIONS, USER_ROLES } from "../utils/constants.js";
import { logSecurityEvent } from "./logger.js";

// Кастомная функция для генерации ключа
const keyGenerator = (req) => {
  // Если пользователь авторизован, используем его ID, иначе IP
  if (req.user && req.user._id) {
    return `user_${req.user._id}`;
  }
  return `ip_${getClientIP(req)}`;
};

// Кастомная функция для пропуска запросов
const skip = (req) => {
  // Админы могут иметь повышенные лимиты для модерации
  if (req.user && req.user.role === USER_ROLES.ADMIN) {
    return false; // не пропускаем, но у них будет выше лимит
  }
  return false;
};

// Функция обработки превышения лимита
const onLimitReached = (req, res, options) => {
  const userId = req.user?._id;
  const ip = getClientIP(req);

  logSecurityEvent(
    "RATE_LIMIT_EXCEEDED",
    `Rate limit exceeded: ${options.max} requests in ${options.windowMs}ms`,
    userId,
    ip
  );
};

// Базовый rate limiter для всех API запросов
export const createApiLimiter = () => {
  return rateLimit({
    windowMs: config.RATE_LIMIT.WINDOW_MS,
    limit: (req) => {
      if (!req.user) return config.RATE_LIMIT.USER.API_REQUESTS;

      switch (req.user.role) {
        case USER_ROLES.ADMIN:
          return config.RATE_LIMIT.ADMIN.API_REQUESTS;
        case USER_ROLES.EXPERT:
          return config.RATE_LIMIT.EXPERT.API_REQUESTS;
        default:
          return config.RATE_LIMIT.USER.API_REQUESTS;
      }
    },
    keyGenerator,
    skip,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: (req) =>
      formatResponse(
        false,
        null,
        "Превышен лимит API запросов. Попробуйте позже.",
        {
          type: "RATE_LIMIT_EXCEEDED",
          resetTime: new Date(Date.now() + config.RATE_LIMIT.WINDOW_MS),
        }
      ),
    onLimitReached,
  });
};

// Rate limiter для создания вопросов
export const createQuestionLimiter = () => {
  return rateLimit({
    windowMs: config.RATE_LIMIT.WINDOW_MS,
    limit: (req) => {
      if (!req.user) return 2; // анонимы почти ничего не могут

      switch (req.user.role) {
        case USER_ROLES.EXPERT:
        case USER_ROLES.ADMIN:
          return config.RATE_LIMIT.EXPERT.QUESTIONS;
        default:
          return config.RATE_LIMIT.USER.QUESTIONS;
      }
    },
    keyGenerator,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: (req) => {
      const maxQuestions =
        req.user?.role === USER_ROLES.EXPERT ||
        req.user?.role === USER_ROLES.ADMIN
          ? config.RATE_LIMIT.EXPERT.QUESTIONS
          : config.RATE_LIMIT.USER.QUESTIONS;

      return formatResponse(
        false,
        null,
        `Превышен лимит создания вопросов (${maxQuestions} в час). Попробуйте позже.`,
        {
          type: "QUESTION_RATE_LIMIT_EXCEEDED",
          maxQuestions,
          resetTime: new Date(Date.now() + config.RATE_LIMIT.WINDOW_MS),
        }
      );
    },
    onLimitReached,
  });
};

// Rate limiter для создания ответов (только эксперты)
export const createAnswerLimiter = () => {
  return rateLimit({
    windowMs: config.RATE_LIMIT.WINDOW_MS,
    limit: (req) => {
      if (!req.user || req.user.role === USER_ROLES.USER) {
        return 0; // обычные пользователи не могут отвечать
      }
      return config.RATE_LIMIT.EXPERT.ANSWERS;
    },
    keyGenerator,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: (req) =>
      formatResponse(
        false,
        null,
        `Превышен лимит создания ответов (${config.RATE_LIMIT.EXPERT.ANSWERS} в час). Попробуйте позже.`,
        {
          type: "ANSWER_RATE_LIMIT_EXCEEDED",
          maxAnswers: config.RATE_LIMIT.EXPERT.ANSWERS,
          resetTime: new Date(Date.now() + config.RATE_LIMIT.WINDOW_MS),
        }
      ),
    onLimitReached,
  });
};

// Rate limiter для комментариев
export const createCommentLimiter = () => {
  return rateLimit({
    windowMs: config.RATE_LIMIT.WINDOW_MS,
    limit: (req) => {
      if (!req.user) return 5; // анонимы ограничены

      switch (req.user.role) {
        case USER_ROLES.EXPERT:
        case USER_ROLES.ADMIN:
          return config.RATE_LIMIT.EXPERT.COMMENTS;
        default:
          return config.RATE_LIMIT.USER.COMMENTS;
      }
    },
    keyGenerator,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: (req) => {
      const maxComments =
        req.user?.role === USER_ROLES.EXPERT ||
        req.user?.role === USER_ROLES.ADMIN
          ? config.RATE_LIMIT.EXPERT.COMMENTS
          : config.RATE_LIMIT.USER.COMMENTS;

      return formatResponse(
        false,
        null,
        `Превышен лимит создания комментариев (${maxComments} в час). Попробуйте позже.`,
        {
          type: "COMMENT_RATE_LIMIT_EXCEEDED",
          maxComments,
          resetTime: new Date(Date.now() + config.RATE_LIMIT.WINDOW_MS),
        }
      );
    },
    onLimitReached,
  });
};

// Rate limiter для лайков
export const createLikeLimiter = () => {
  return rateLimit({
    windowMs: config.RATE_LIMIT.WINDOW_MS,
    limit: config.RATE_LIMIT.USER.LIKES, // одинаково для всех ролей
    keyGenerator,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: formatResponse(
      false,
      null,
      `Превышен лимит лайков (${config.RATE_LIMIT.USER.LIKES} в час). Попробуйте позже.`,
      {
        type: "LIKE_RATE_LIMIT_EXCEEDED",
        maxLikes: config.RATE_LIMIT.USER.LIKES,
        resetTime: new Date(Date.now() + config.RATE_LIMIT.WINDOW_MS),
      }
    ),
    onLimitReached,
  });
};

// Строгий rate limiter для аутентификации
export const createAuthLimiter = () => {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    limit: 5, // только 5 попыток входа за 15 минут
    keyGenerator: (req) => getClientIP(req), // только по IP
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: formatResponse(
      false,
      null,
      "Слишком много попыток входа. Попробуйте через 15 минут.",
      {
        type: "AUTH_RATE_LIMIT_EXCEEDED",
        resetTime: new Date(Date.now() + 15 * 60 * 1000),
      }
    ),
    onLimitReached: (req, res, options) => {
      logSecurityEvent(
        "AUTH_RATE_LIMIT_EXCEEDED",
        `Auth rate limit exceeded: ${options.limit} attempts in ${options.windowMs}ms`,
        null,
        getClientIP(req)
      );
    },
  });
};

// Middleware для проверки кастомного rate limit из базы данных
export const checkCustomRateLimit = (action) => {
  return async (req, res, next) => {
    try {
      const identifier = req.user ? req.user._id : getClientIP(req);
      const isUserId = !!req.user;

      // Определяем лимит в зависимости от роли и действия
      let limit;
      switch (action) {
        case RATE_LIMIT_ACTIONS.QUESTION_CREATE:
          limit =
            req.user?.role === USER_ROLES.EXPERT ||
            req.user?.role === USER_ROLES.ADMIN
              ? config.RATE_LIMIT.EXPERT.QUESTIONS
              : config.RATE_LIMIT.USER.QUESTIONS;
          break;
        case RATE_LIMIT_ACTIONS.ANSWER_CREATE:
          limit = config.RATE_LIMIT.EXPERT.ANSWERS;
          break;
        case RATE_LIMIT_ACTIONS.COMMENT_CREATE:
          limit =
            req.user?.role === USER_ROLES.EXPERT ||
            req.user?.role === USER_ROLES.ADMIN
              ? config.RATE_LIMIT.EXPERT.COMMENTS
              : config.RATE_LIMIT.USER.COMMENTS;
          break;
        case RATE_LIMIT_ACTIONS.LIKE:
          limit = config.RATE_LIMIT.USER.LIKES;
          break;
        default:
          return next();
      }

      const result = await RateLimit.checkLimit(
        identifier,
        action,
        limit,
        config.RATE_LIMIT.WINDOW_MS
      );

      // Добавляем заголовки
      res.set({
        "RateLimit-Limit": limit,
        "RateLimit-Remaining": Math.max(0, result.remaining),
        "RateLimit-Reset": Math.ceil((result.resetTime - new Date()) / 1000),
      });

      if (!result.allowed) {
        logSecurityEvent(
          "RATE_LIMIT_EXCEEDED",
          `Custom rate limit exceeded for action ${action}: ${result.count}/${limit}`,
          req.user?._id,
          getClientIP(req)
        );

        return res.status(429).json(
          formatResponse(
            false,
            null,
            `Превышен лимит для действия ${action}. Попробуйте позже.`,
            {
              type: "CUSTOM_RATE_LIMIT_EXCEEDED",
              action,
              current: result.count,
              limit,
              resetTime: result.resetTime,
            }
          )
        );
      }

      next();
    } catch (error) {
      console.error("Custom rate limit error:", error);
      // При ошибке rate limiting пропускаем запрос
      next();
    }
  };
};

export default {
  createApiLimiter,
  createQuestionLimiter,
  createAnswerLimiter,
  createCommentLimiter,
  createLikeLimiter,
  createAuthLimiter,
  checkCustomRateLimit,
};
