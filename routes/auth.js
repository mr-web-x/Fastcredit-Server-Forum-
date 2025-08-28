// routes/auth.js
import express from "express";
import authController from "../controllers/authController.js";
import { authenticate, requireAdmin } from "../middlewares/auth.js";
import { createAuthLimiter } from "../middlewares/rateLimit.js";
import { validateProfileUpdate } from "../middlewares/validation.js";
import { checkUserBan } from "../middlewares/banCheck.js";

const router = express.Router();

// Применяем строгий rate limiting для всех auth роутов
router.use(createAuthLimiter());

// POST /api/auth/verify-token - верификация токена из внешнего микросервиса
router.post("/verify-token", authController.verifyToken);

// GET /api/auth/me - получение информации о текущем пользователе
router.get("/me", authenticate, checkUserBan, authController.getCurrentUser);

// PUT /api/auth/profile - обновление профиля пользователя
router.put(
  "/profile",
  authenticate,
  checkUserBan,
  validateProfileUpdate,
  authController.updateProfile
);

// GET /api/auth/permissions - проверка прав доступа пользователя
router.get(
  "/permissions",
  authenticate,
  checkUserBan,
  authController.checkPermissions
);

// POST /api/auth/logout - логаут (логирование на сервере)
router.post("/logout", authenticate, authController.logout);

// GET /api/auth/statistics - статистика аутентификации (только админы)
router.get(
  "/statistics",
  authenticate,
  checkUserBan,
  requireAdmin,
  authController.getAuthStatistics
);

// GET /api/auth/health - проверка состояния auth сервиса
router.get("/health", authController.healthCheck);

export default router;
