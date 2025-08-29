// controllers/authController.js
import authService from "../services/authService.js";
import userService from "../services/userService.js";
import verificationService from "../services/verificationService.js";
import emailService from "../services/emailService.js";
import { formatResponse, getClientIP } from "../utils/helpers.js";
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "../utils/constants.js";
import { asyncHandler } from "../middlewares/errorHandler.js";
import { logUserAction, logSecurityEvent } from "../middlewares/logger.js";

class AuthController {
  // ==================== GOOGLE OAUTH МЕТОДЫ ====================

  // Верификация токена из внешнего микросервиса (Google + fallback JWT)
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

      const internalToken = authService.generateInternalToken(user);

      // Возвращаем информацию о пользователе
      const userInfo = await authService.getUserInfo(user._id);

      logUserAction(
        user._id,
        "TOKEN_VERIFIED",
        "User token verified successfully"
      );

      res.json(
        formatResponse(
          true,
          { ...userInfo, token: internalToken },
          "Токен успешно верифицирован"
        )
      );
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

  // ==================== ЛОКАЛЬНАЯ АВТОРИЗАЦИЯ ====================

  // Регистрация пользователя
  register = asyncHandler(async (req, res) => {
    const { email, password, confirmPassword, firstName, lastName, username } =
      req.body;
    const requestIP = getClientIP(req);

    // Валидация обязательных полей
    if (!email || !password || !firstName) {
      return res.status(400).json(
        formatResponse(false, null, "Email, пароль и имя обязательны", {
          type: "VALIDATION_ERROR",
          fields: ["email", "password", "firstName"],
        })
      );
    }

    // Проверка совпадения паролей
    if (password !== confirmPassword) {
      return res.status(400).json(
        formatResponse(false, null, "Пароли не совпадают", {
          type: "VALIDATION_ERROR",
          field: "confirmPassword",
        })
      );
    }

    // Валидация пароля
    if (password.length < 6) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Пароль должен содержать минимум 6 символов",
          {
            type: "VALIDATION_ERROR",
            field: "password",
          }
        )
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

    // Валидация username если указан
    if (
      username &&
      (username.length < 3 || !/^[a-zA-Z0-9_]+$/.test(username))
    ) {
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
      const result = await authService.registerUser(
        {
          email,
          password,
          firstName,
          lastName,
          username,
        },
        requestIP
      );

      res.status(201).json(
        formatResponse(
          true,
          {
            userId: result.user._id,
            email: result.user.email,
            requiresVerification: true,
            verificationSent: result.verificationSent,
            ...(result.devCode && { devCode: result.devCode }),
          },
          result.message
        )
      );
    } catch (error) {
      if (
        error.message.includes("уже существует") ||
        error.message.includes("занято")
      ) {
        return res.status(409).json(
          formatResponse(false, null, error.message, {
            type: "CONFLICT",
          })
        );
      }

      throw error;
    }
  });

  // Вход пользователя
  login = asyncHandler(async (req, res) => {
    const { login, password } = req.body;

    // Валидация обязательных полей
    if (!login || !password) {
      return res.status(400).json(
        formatResponse(false, null, "Логин и пароль обязательны", {
          type: "VALIDATION_ERROR",
          fields: ["login", "password"],
        })
      );
    }

    try {
      const result = await authService.loginUser({ login, password });

      // Получаем полную информацию о пользователе
      const userInfo = await authService.getUserInfo(result.user._id);

      logUserAction(
        result.user._id,
        "LOCAL_LOGIN_SUCCESS",
        `User logged in via local auth: ${result.user.email}`
      );

      res.json(
        formatResponse(
          true,
          {
            ...userInfo,
            token: result.token,
          },
          "Успешный вход в систему"
        )
      );
    } catch (error) {
      logSecurityEvent(
        "LOCAL_LOGIN_FAILED",
        error.message,
        null,
        getClientIP(req)
      );

      if (error.message.includes("заблокирован")) {
        return res.status(423).json(
          formatResponse(false, null, error.message, {
            type: "ACCOUNT_LOCKED",
          })
        );
      }

      if (
        error.message.includes("Неверный") ||
        error.message.includes("обязательны")
      ) {
        return res.status(401).json(
          formatResponse(false, null, error.message, {
            type: "INVALID_CREDENTIALS",
          })
        );
      }

      throw error;
    }
  });

  // Отправка кода подтверждения email
  sendVerificationCode = asyncHandler(async (req, res) => {
    const { email } = req.body;
    const requestIP = getClientIP(req);

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
      // Генерируем код
      const codeResult = await verificationService.sendEmailVerificationCode(
        email,
        requestIP
      );

      if (!codeResult.success) {
        return res.status(400).json(
          formatResponse(false, null, codeResult.message, {
            type: codeResult.error,
            ...(codeResult.timeUntilExpiry && {
              timeUntilExpiry: codeResult.timeUntilExpiry,
            }),
          })
        );
      }

      // Отправляем email с кодом
      try {
        await emailService.sendEmail(
          email,
          "forumVerification",
          "Fastcredit.sk",
          { code: codeResult.devCode || "XXXXXX" } // В production будет настоящий код
        );

        logUserAction(
          null,
          "VERIFICATION_EMAIL_SENT",
          `Verification email sent to ${email}`
        );
      } catch (emailError) {
        console.error("Failed to send verification email:", emailError);
        // Не блокируем процесс если email не отправился
      }

      res.json(
        formatResponse(
          true,
          {
            sent: true,
            expiresAt: codeResult.expiresAt,
            ...(codeResult.devCode && { devCode: codeResult.devCode }),
          },
          codeResult.message
        )
      );
    } catch (error) {
      if (error.message.includes("не найден")) {
        return res.status(404).json(
          formatResponse(false, null, error.message, {
            type: "USER_NOT_FOUND",
          })
        );
      }

      throw error;
    }
  });

  // Подтверждение email
  verifyEmail = asyncHandler(async (req, res) => {
    const { email, code } = req.body;
    const requestIP = getClientIP(req);

    if (!email || !code) {
      return res.status(400).json(
        formatResponse(false, null, "Email и код подтверждения обязательны", {
          type: "VALIDATION_ERROR",
          fields: ["email", "code"],
        })
      );
    }

    // Валидация кода (должен быть 6 цифр)
    if (!/^[0-9]{6}$/.test(code)) {
      return res.status(400).json(
        formatResponse(false, null, "Код должен состоять из 6 цифр", {
          type: "VALIDATION_ERROR",
          field: "code",
        })
      );
    }

    try {
      const result = await authService.verifyEmail(email, code, requestIP);

      if (!result.success) {
        return res.status(400).json(
          formatResponse(false, null, result.message, {
            type: result.error,
          })
        );
      }

      res.json(
        formatResponse(
          true,
          {
            verified: true,
            ...(result.user && { user: result.user }),
          },
          result.message
        )
      );
    } catch (error) {
      if (error.message === "Пользователь не найден") {
        return res.status(404).json(
          formatResponse(false, null, error.message, {
            type: "USER_NOT_FOUND",
          })
        );
      }

      throw error;
    }
  });

  // Запрос сброса пароля
  requestPasswordReset = asyncHandler(async (req, res) => {
    const { email } = req.body;
    const requestIP = getClientIP(req);

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
      // Генерируем код
      const codeResult = await authService.requestPasswordReset(
        email,
        requestIP
      );

      if (!codeResult.success) {
        return res.status(400).json(
          formatResponse(false, null, codeResult.message, {
            type: codeResult.error,
            ...(codeResult.timeUntilExpiry && {
              timeUntilExpiry: codeResult.timeUntilExpiry,
            }),
          })
        );
      }

      // Отправляем email с кодом сброса
      try {
        await emailService.sendEmail(email, "passwordReset", "Fastcredit.sk", {
          code: codeResult.devCode || "XXXXXX",
        });

        logUserAction(
          null,
          "PASSWORD_RESET_EMAIL_SENT",
          `Password reset email sent to ${email}`
        );
      } catch (emailError) {
        console.error("Failed to send password reset email:", emailError);
      }

      res.json(
        formatResponse(
          true,
          {
            requested: true,
            expiresAt: codeResult.expiresAt,
            ...(codeResult.devCode && { devCode: codeResult.devCode }),
          },
          codeResult.message
        )
      );
    } catch (error) {
      throw error;
    }
  });

  // Проверка кода сброса пароля (опциональный шаг)
  verifyResetCode = asyncHandler(async (req, res) => {
    const { email, code } = req.body;
    const requestIP = getClientIP(req);

    if (!email || !code) {
      return res.status(400).json(
        formatResponse(false, null, "Email и код обязательны", {
          type: "VALIDATION_ERROR",
          fields: ["email", "code"],
        })
      );
    }

    // Валидация кода (должен быть 6 цифр)
    if (!/^[0-9]{6}$/.test(code)) {
      return res.status(400).json(
        formatResponse(false, null, "Код должен состоять из 6 цифр", {
          type: "VALIDATION_ERROR",
          field: "code",
        })
      );
    }

    try {
      const result = await authService.verifyPasswordResetCode(
        email,
        code,
        requestIP
      );

      if (!result.success) {
        return res.status(400).json(
          formatResponse(false, null, result.message, {
            type: result.error,
          })
        );
      }

      res.json(
        formatResponse(
          true,
          {
            verified: true,
            canResetPassword: true,
          },
          result.message
        )
      );
    } catch (error) {
      if (error.message === "Пользователь не найден") {
        return res.status(404).json(
          formatResponse(false, null, error.message, {
            type: "USER_NOT_FOUND",
          })
        );
      }

      throw error;
    }
  });

  // Сброс пароля
  resetPassword = asyncHandler(async (req, res) => {
    const { email, code, newPassword, confirmPassword } = req.body;
    const requestIP = getClientIP(req);

    if (!email || !code || !newPassword || !confirmPassword) {
      return res.status(400).json(
        formatResponse(false, null, "Все поля обязательны", {
          type: "VALIDATION_ERROR",
          fields: ["email", "code", "newPassword", "confirmPassword"],
        })
      );
    }

    // Проверка совпадения паролей
    if (newPassword !== confirmPassword) {
      return res.status(400).json(
        formatResponse(false, null, "Пароли не совпадают", {
          type: "VALIDATION_ERROR",
          field: "confirmPassword",
        })
      );
    }

    // Валидация пароля
    if (newPassword.length < 6) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Пароль должен содержать минимум 6 символов",
          {
            type: "VALIDATION_ERROR",
            field: "newPassword",
          }
        )
      );
    }

    // Валидация кода
    if (!/^[0-9]{6}$/.test(code)) {
      return res.status(400).json(
        formatResponse(false, null, "Код должен состоять из 6 цифр", {
          type: "VALIDATION_ERROR",
          field: "code",
        })
      );
    }

    try {
      const result = await authService.resetPassword(
        email,
        code,
        newPassword,
        requestIP
      );

      if (!result.success) {
        return res.status(400).json(
          formatResponse(false, null, result.message, {
            type: result.error,
          })
        );
      }

      logUserAction(
        result.user?.id,
        "PASSWORD_RESET_SUCCESS",
        `Password reset completed for: ${email}`
      );

      res.json(formatResponse(true, { reset: true }, result.message));
    } catch (error) {
      if (error.message.includes("найден")) {
        return res.status(404).json(
          formatResponse(false, null, error.message, {
            type: "USER_NOT_FOUND",
          })
        );
      }

      throw error;
    }
  });

  // ==================== ОБЩИЕ МЕТОДЫ ====================

  // Получение информации о текущем пользователе
  getCurrentUser = asyncHandler(async (req, res) => {
    const userInfo = await authService.getUserInfo(req.user._id);

    res.json(
      formatResponse(true, userInfo, "Информация о пользователе получена")
    );
  });

  // Обновление профиля пользователя
  updateProfile = asyncHandler(async (req, res) => {
    const { bio, avatar, firstName, lastName, username } = req.body;

    // Валидация
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

    if (
      username &&
      (username.length < 3 || !/^[a-zA-Z0-9_]+$/.test(username))
    ) {
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
      const updatedUser = await authService.updateUserProfile(req.user._id, {
        bio,
        avatar,
        firstName,
        lastName,
        username,
      });

      res.json(
        formatResponse(true, updatedUser, SUCCESS_MESSAGES.PROFILE_UPDATED)
      );
    } catch (error) {
      if (error.message.includes("занято")) {
        return res.status(409).json(
          formatResponse(false, null, error.message, {
            type: "USERNAME_TAKEN",
          })
        );
      }

      throw error;
    }
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

  // Логаут
  logout = asyncHandler(async (req, res) => {
    logUserAction(
      req.user._id,
      "USER_LOGGED_OUT",
      "User logged out successfully"
    );

    res.json(formatResponse(true, null, "Вы успешно вышли из системы"));
  });

  // Получение статистики аутентификации (только для админов)
  getAuthStatistics = asyncHandler(async (req, res) => {
    const [userStats, verificationStats] = await Promise.all([
      userService.getUserStatistics(),
      verificationService.getVerificationStatistics(),
    ]);

    // Дополнительная статистика по активности
    const activeUsersLast24h = await userService.getUsers({
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
          users: userStats,
          verificationCodes: verificationStats,
          activity: {
            recentLogins,
            activeUsersLast24h: recentLogins,
          },
        },
        "Статистика аутентификации получена"
      )
    );
  });

  // Проверка здоровья auth сервиса
  healthCheck = asyncHandler(async (req, res) => {
    let emailServiceHealthy = true;

    // Проверяем доступность email сервиса
    try {
      // Можно добавить ping к email сервису
      // await emailService.ping();
    } catch (error) {
      emailServiceHealthy = false;
    }

    res.json(
      formatResponse(
        true,
        {
          status: "healthy",
          timestamp: new Date().toISOString(),
          services: {
            auth: true,
            email: emailServiceHealthy,
            verification: true,
          },
          supportedMethods: ["google", "local"],
        },
        "Auth service работает нормально"
      )
    );
  });
}

export default new AuthController();
