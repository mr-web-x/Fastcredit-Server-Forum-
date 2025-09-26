// routes/auth.js
import express from "express";
import authController from "../controllers/authController.js";
import authService from "../services/authService.js";
import verificationService from "../services/verificationService.js";
import User from "../models/User.js";
import { authenticate, requireAdmin } from "../middlewares/auth.js";
import {
  createAuthLimiter,
  createApiLimiter,
} from "../middlewares/rateLimit.js";
import { checkUserBan } from "../middlewares/banCheck.js";
import { formatResponse } from "../utils/helpers.js";
import { asyncHandler } from "../middlewares/errorHandler.js";
import cryptoService from "../services/cryptoService.js";

const router = express.Router();

// Rate limiters
const authLimiter = createAuthLimiter(); // Строгий лимит для auth (5 попыток за 15 мин)
const apiLimiter = createApiLimiter(); // Обычный лимит для утилит

// ==================== ПУБЛИЧНЫЕ РОУТЫ ====================

// Google OAuth - верификация токена
router.post("/verify-token", authLimiter, authController.verifyToken);

// Регистрация пользователя
router.post("/register", authLimiter, authController.register);

// Вход пользователя
router.post("/login", authLimiter, authController.login);

// Отправка кода подтверждения email
router.post(
  "/send-verification-code",
  authLimiter,
  authController.sendVerificationCode
);

// Подтверждение email по коду
router.post("/verify-email", authLimiter, authController.verifyEmail);

// Запрос кода сброса пароля
router.post(
  "/request-password-reset",
  authLimiter,
  authController.requestPasswordReset
);

// Проверка кода сброса пароля
router.post("/verify-reset-code", authLimiter, authController.verifyResetCode);

// Сброс пароля по коду
router.post("/reset-password", authLimiter, authController.resetPassword);

// Проверка здоровья сервиса
router.get("/health", authController.healthCheck);

// ==================== ЗАЩИЩЕННЫЕ РОУТЫ ====================

// Получение текущего пользователя
router.get("/me", authenticate, checkUserBan, authController.getCurrentUser);

// Обновление профиля
router.put(
  "/profile",
  authenticate,
  checkUserBan,
  apiLimiter,
  authController.updateProfile
);

// Проверка прав доступа
router.get(
  "/permissions",
  authenticate,
  checkUserBan,
  authController.checkPermissions
);

// Выход из системы
router.post("/logout", authenticate, authController.logout);

// ==================== УТИЛИТЫ ====================

// Проверка доступности email - ЗАВЕРШАЕМ (был обрезан)
router.post(
  "/check-email",
  apiLimiter,
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json(
        formatResponse(false, null, "Email обязателен", {
          type: "VALIDATION_ERROR",
          field: "email",
        })
      );
    }

    // Валидация email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат email", {
          type: "VALIDATION_ERROR",
          field: "email",
        })
      );
    }

    try {
      const result = await authService.checkEmailAvailability(email);

      res.json(
        formatResponse(
          true,
          {
            email,
            available: result.available,
          },
          result.message
        )
      );
    } catch (error) {
      throw error;
    }
  })
);

// Проверка доступности username
router.post(
  "/check-username",
  apiLimiter,
  asyncHandler(async (req, res) => {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json(
        formatResponse(false, null, "Username обязателен", {
          type: "VALIDATION_ERROR",
          field: "username",
        })
      );
    }

    // Валидация username
    if (username.length < 3 || !/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Username должен содержать минимум 3 символа (буквы, цифры, _)",
          {
            type: "VALIDATION_ERROR",
            field: "username",
          }
        )
      );
    }

    try {
      const result = await authService.checkUsernameAvailability(username);

      res.json(
        formatResponse(
          true,
          {
            username,
            available: result.available,
          },
          result.message
        )
      );
    } catch (error) {
      throw error;
    }
  })
);

// Получение статуса активного кода
router.post(
  "/code-status",
  apiLimiter,
  asyncHandler(async (req, res) => {
    const { email, type } = req.body;

    if (!email || !type) {
      return res.status(400).json(
        formatResponse(false, null, "Email и тип кода обязательны", {
          type: "VALIDATION_ERROR",
          fields: ["email", "type"],
        })
      );
    }

    if (!["email_verification", "password_reset"].includes(type)) {
      return res.status(400).json(
        formatResponse(false, null, "Недопустимый тип кода", {
          type: "VALIDATION_ERROR",
          field: "type",
          allowedValues: ["email_verification", "password_reset"],
        })
      );
    }

    try {
      const codeInfo = await verificationService.getActiveCodeInfo(email, type);

      res.json(formatResponse(true, codeInfo, "Информация о коде получена"));
    } catch (error) {
      throw error;
    }
  })
);

// ==================== АДМИНСКИЕ РОУТЫ ====================

// Статистика аутентификации
router.get(
  "/statistics",
  authenticate,
  checkUserBan,
  requireAdmin,
  authController.getAuthStatistics
);

// Получение истории кодов пользователя
router.post(
  "/admin/code-history",
  authenticate,
  checkUserBan,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { email, limit } = req.body;

    if (!email) {
      return res.status(400).json(
        formatResponse(false, null, "Email обязателен", {
          type: "VALIDATION_ERROR",
          field: "email",
        })
      );
    }

    try {
      const history = await verificationService.getCodeHistory(
        email,
        limit || 10
      );

      res.json(formatResponse(true, history, "История кодов получена"));
    } catch (error) {
      throw error;
    }
  })
);

// Очистка истекших кодов
router.post(
  "/admin/cleanup-codes",
  authenticate,
  checkUserBan,
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      const result = await verificationService.cleanupExpiredCodes();

      res.json(formatResponse(true, result, "Очистка кодов выполнена"));
    } catch (error) {
      throw error;
    }
  })
);

// Статистика кодов подтверждения
router.get(
  "/admin/verification-stats",
  authenticate,
  checkUserBan,
  requireAdmin,
  asyncHandler(async (req, res) => {
    try {
      const stats = await verificationService.getVerificationStatistics();

      res.json(formatResponse(true, stats, "Статистика кодов получена"));
    } catch (error) {
      throw error;
    }
  })
);

// ==================== РАЗРАБОТЧЕСКИЕ РОУТЫ ====================
// Только в режиме development
if (process.env.NODE_ENV === "development") {
  // Генерация тестового токена для разработки
  router.post(
    "/dev/generate-token",
    asyncHandler(async (req, res) => {
      const { email } = req.body;

      if (!email) {
        return res
          .status(400)
          .json(formatResponse(false, null, "Email обязателен"));
      }

      try {
        const user = await User.findOne({ email });
        await cryptoService.smartDecrypt(user);
        if (!user) {
          return res
            .status(404)
            .json(formatResponse(false, null, "Пользователь не найден"));
        }

        const token = authService.generateInternalToken(user);

        res.json(
          formatResponse(
            true,
            {
              token,
              user: {
                id: user._id,
                email: user.email,
                role: user.role,
              },
            },
            "Тестовый токен сгенерирован"
          )
        );
      } catch (error) {
        throw error;
      }
    })
  );

  // Отмена активного кода
  router.post(
    "/dev/cancel-code",
    asyncHandler(async (req, res) => {
      const { email, type } = req.body;

      if (!email || !type) {
        return res
          .status(400)
          .json(formatResponse(false, null, "Email и тип кода обязательны"));
      }

      try {
        const result = await verificationService.cancelActiveCode(email, type);

        res.json(formatResponse(true, result, result.message));
      } catch (error) {
        throw error;
      }
    })
  );

  // Список пользователей для тестирования
  router.get(
    "/dev/users",
    asyncHandler(async (req, res) => {
      try {
        const users = await User.find({})
          .select("email username role provider isEmailVerified createdAt")
          .sort({ createdAt: -1 })
          .limit(50);

        await cryptoService.smartDecrypt(users);

        res.json(
          formatResponse(true, users, `Найдено ${users.length} пользователей`)
        );
      } catch (error) {
        throw error;
      }
    })
  );

  // Принудительная верификация email (только для разработки)
  router.post(
    "/dev/force-verify-email",
    asyncHandler(async (req, res) => {
      const { email } = req.body;

      if (!email) {
        return res
          .status(400)
          .json(formatResponse(false, null, "Email обязателен"));
      }

      try {
        const user = await User.findOne({ email, provider: "local" });

        await cryptoService.smartDecrypt(user);

        if (!user) {
          return res
            .status(404)
            .json(formatResponse(false, null, "Пользователь не найден"));
        }

        user.isEmailVerified = true;
        user.isVerified = true;
        await user.save();

        res.json(
          formatResponse(
            true,
            { userId: user._id, email: user.email },
            "Email принудительно верифицирован"
          )
        );
      } catch (error) {
        throw error;
      }
    })
  );

  // Сброс попыток входа (для тестирования)
  router.post(
    "/dev/reset-login-attempts",
    asyncHandler(async (req, res) => {
      const { email } = req.body;

      if (!email) {
        return res
          .status(400)
          .json(formatResponse(false, null, "Email обязателен"));
      }

      try {
        const user = await User.findOne({ email });

        await cryptoService.smartDecrypt(user);

        if (!user) {
          return res
            .status(404)
            .json(formatResponse(false, null, "Пользователь не найден"));
        }

        await user.resetLoginAttempts();

        res.json(
          formatResponse(
            true,
            { userId: user._id, email: user.email },
            "Попытки входа сброшены"
          )
        );
      } catch (error) {
        throw error;
      }
    })
  );

  // Получение информации о коде для разработки
  router.post(
    "/dev/get-code",
    asyncHandler(async (req, res) => {
      const { email, type } = req.body;

      if (!email || !type) {
        return res
          .status(400)
          .json(formatResponse(false, null, "Email и тип кода обязательны"));
      }

      try {
        const code = await VerificationCode.findActiveCode(email, type);

        if (!code) {
          return res
            .status(404)
            .json(formatResponse(false, null, "Активный код не найден"));
        }

        res.json(
          formatResponse(
            true,
            {
              code: code.code,
              expiresAt: code.expiresAt,
              attempts: code.attempts,
              type: code.type,
            },
            "Информация о коде получена"
          )
        );
      } catch (error) {
        throw error;
      }
    })
  );
}

export default router;
