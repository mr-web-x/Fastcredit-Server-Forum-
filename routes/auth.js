// routes/auth.js
import express from "express";
import authController from "../controllers/authController.js";
import authService from "../services/authService.js";
import userService from "../services/userService.js";
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

// Проверка доступности email
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

    const isAvailable = await userService.isEmailAvailable(email);

    res.json(
      formatResponse(
        true,
        { available: isAvailable },
        isAvailable ? "Email доступен" : "Email уже используется"
      )
    );
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

    const isAvailable = await userService.isUsernameAvailable(username);

    res.json(
      formatResponse(
        true,
        { available: isAvailable },
        isAvailable ? "Username доступен" : "Username уже занят"
      )
    );
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

    const codeInfo = await verificationService.getActiveCodeInfo(email, type);

    res.json(formatResponse(true, codeInfo, "Информация о коде получена"));
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

    const history = await verificationService.getCodeHistory(
      email,
      limit || 10
    );

    res.json(formatResponse(true, history, "История кодов получена"));
  })
);

// Очистка истекших кодов
router.post(
  "/admin/cleanup-codes",
  authenticate,
  checkUserBan,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const result = await verificationService.cleanupExpiredCodes();

    res.json(formatResponse(true, result, "Очистка кодов выполнена"));
  })
);

// Статистика кодов подтверждения
router.get(
  "/admin/verification-stats",
  authenticate,
  checkUserBan,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const stats = await verificationService.getVerificationStatistics();

    res.json(formatResponse(true, stats, "Статистика кодов получена"));
  })
);

// Принудительная верификация email
router.post(
  "/admin/force-verify",
  authenticate,
  checkUserBan,
  requireAdmin,
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

    const user = await User.findOne({ email, provider: "local" });
    if (!user) {
      return res.status(404).json(
        formatResponse(false, null, "Пользователь не найден", {
          type: "USER_NOT_FOUND",
        })
      );
    }

    if (user.isEmailVerified) {
      return res.json(
        formatResponse(
          true,
          { alreadyVerified: true },
          "Email уже верифицирован"
        )
      );
    }

    user.isEmailVerified = true;
    user.isVerified = true;
    await user.save();

    res.json(
      formatResponse(
        true,
        {
          verified: true,
          email: user.email,
        },
        `Email ${email} принудительно верифицирован`
      )
    );
  })
);

// ==================== DEVELOPMENT РОУТЫ ====================

if (process.env.NODE_ENV === "development") {
  // Генерация тестового токена
  router.post(
    "/dev/generate-token",
    asyncHandler(async (req, res) => {
      const { email } = req.body;

      if (!email) {
        return res
          .status(400)
          .json(formatResponse(false, null, "Email обязателен"));
      }

      const user = await User.findOne({ email });
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

      const result = await verificationService.cancelActiveCode(email, type);

      res.json(formatResponse(true, result, result.message));
    })
  );

  // Список пользователей для тестирования
  router.get(
    "/dev/users",
    asyncHandler(async (req, res) => {
      const users = await User.find({})
        .select("email username role provider isEmailVerified createdAt")
        .sort({ createdAt: -1 })
        .limit(50);

      res.json(
        formatResponse(true, users, `Найдено ${users.length} пользователей`)
      );
    })
  );
}

export default router;
