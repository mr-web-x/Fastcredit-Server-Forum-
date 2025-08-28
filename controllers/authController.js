// controllers/authController.js
import authService from "../services/authService.js";
import userService from "../services/userService.js";
import { formatResponse, getClientIP } from "../utils/helpers.js";
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "../utils/constants.js";
import { asyncHandler } from "../middlewares/errorHandler.js";
import { logUserAction, logSecurityEvent } from "../middlewares/logger.js";

class AuthController {
  // Верификация токена и получение информации о пользователе
  verifyToken = asyncHandler(async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json(
        formatResponse(false, null, ERROR_MESSAGES.UNAUTHORIZED, {
          type: "MISSING_TOKEN",
        })
      );
    }

    try {
      // Получаем пользователя из токена через authService
      const user = await authService.getUserFromToken(token);

      // Проверяем статус пользователя
      const statusCheck = await authService.validateUserStatus(user);

      if (!statusCheck.valid) {
        logSecurityEvent(
          "TOKEN_VERIFICATION_FAILED",
          statusCheck.reason,
          user._id,
          getClientIP(req)
        );

        return res.status(403).json(
          formatResponse(false, null, statusCheck.message, {
            type: statusCheck.reason,
            ...statusCheck.banInfo,
          })
        );
      }

      // Возвращаем информацию о пользователе
      const userInfo = await authService.getUserInfo(user._id);

      logUserAction(
        user._id,
        "TOKEN_VERIFIED",
        "User token verified successfully"
      );

      res.json(formatResponse(true, userInfo, "Токен успешно верифицирован"));
    } catch (error) {
      logSecurityEvent(
        "TOKEN_VERIFICATION_ERROR",
        error.message,
        null,
        getClientIP(req)
      );

      if (error.message.includes("TOKEN_EXPIRED")) {
        return res.status(401).json(
          formatResponse(false, null, "Токен истек. Необходимо войти заново", {
            type: "TOKEN_EXPIRED",
          })
        );
      }

      if (error.message.includes("INVALID_TOKEN")) {
        return res.status(401).json(
          formatResponse(false, null, ERROR_MESSAGES.INVALID_TOKEN, {
            type: "INVALID_TOKEN",
          })
        );
      }

      throw error;
    }
  });

  // Получение информации о текущем пользователе (требует auth middleware)
  getCurrentUser = asyncHandler(async (req, res) => {
    const userInfo = await authService.getUserInfo(req.user._id);

    res.json(
      formatResponse(true, userInfo, "Информация о пользователе получена")
    );
  });

  // Обновление профиля пользователя
  updateProfile = asyncHandler(async (req, res) => {
    const { bio, avatar } = req.body;

    // Базовая валидация
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

    const updatedUser = await authService.updateUserProfile(req.user._id, {
      bio,
      avatar,
    });

    res.json(
      formatResponse(true, updatedUser, SUCCESS_MESSAGES.PROFILE_UPDATED)
    );
  });

  // Проверка прав доступа пользователя
  checkPermissions = asyncHandler(async (req, res) => {
    const { requiredRole } = req.query;

    const permissionCheck = await authService.checkUserPermissions(
      req.user._id,
      requiredRole
    );

    if (!permissionCheck.hasAccess) {
      return res.status(403).json(
        formatResponse(false, null, "Недостаточно прав доступа", {
          type: "INSUFFICIENT_PERMISSIONS",
          reason: permissionCheck.reason,
          requiredRole,
        })
      );
    }

    res.json(
      formatResponse(
        true,
        {
          hasAccess: true,
          userRole: permissionCheck.user.role,
          permissions: permissionCheck.permissions,
        },
        "Проверка прав доступа пройдена"
      )
    );
  });

  // Получение статистики аутентификации (только для админов)
  getAuthStatistics = asyncHandler(async (req, res) => {
    // Эта функция будет вызываться только после middleware requireAdmin

    const stats = await userService.getUserStatistics();

    // Дополнительная статистика по активности
    const activeUsersLast24h = await userService.getUsers({
      // Пользователи, которые заходили за последние 24 часа
      limit: 1000,
    });

    const recentLogins = activeUsersLast24h.data.filter((user) => {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return user.lastLoginAt && new Date(user.lastLoginAt) > dayAgo;
    }).length;

    res.json(
      formatResponse(
        true,
        {
          ...stats,
          recentLogins,
          activeUsersLast24h: recentLogins,
        },
        "Статистика аутентификации получена"
      )
    );
  });

  // Логаут (очистка на клиенте, логирование на сервере)
  logout = asyncHandler(async (req, res) => {
    logUserAction(
      req.user._id,
      "USER_LOGGED_OUT",
      "User logged out successfully"
    );

    res.json(formatResponse(true, null, "Вы успешно вышли из системы"));
  });

  // Проверка здоровья auth сервиса
  healthCheck = asyncHandler(async (req, res) => {
    const isConnected = true; // Можно добавить реальную проверку соединения с auth микросервисом

    if (!isConnected) {
      return res.status(503).json(
        formatResponse(false, null, "Auth service недоступен", {
          type: "SERVICE_UNAVAILABLE",
        })
      );
    }

    res.json(
      formatResponse(
        true,
        {
          status: "healthy",
          timestamp: new Date().toISOString(),
          authServiceConnected: isConnected,
        },
        "Auth service работает нормально"
      )
    );
  });
}

export default new AuthController();
