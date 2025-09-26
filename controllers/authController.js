// controllers/authController.js
import authService from "../services/authService.js";
import userService from "../services/userService.js";
import verificationService from "../services/verificationService.js";
import emailService from "../services/emailService.js";
import { formatResponse, getClientIP } from "../utils/helpers.js";
import { ERROR_MESSAGES } from "../utils/constants.js";
import { asyncHandler } from "../middlewares/errorHandler.js";
import { logUserAction, logSecurityEvent } from "../middlewares/logger.js";

class AuthController {
  // ==================== GOOGLE OAUTH МЕТОДЫ ====================

  // Верификация токена из внешнего микросервиса (Google + fallback JWT) - ЗАВЕРШАЕМ
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
          "Token bol úspešne overený"
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
          formatResponse(
            false,
            null,
            "Token vypršal. Je potrebné sa znova prihlásiť",
            {
              type: "TOKEN_EXPIRED",
            }
          )
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

  // Регистрация пользователя - ЗАВЕРШАЕМ
  register = asyncHandler(async (req, res) => {
    const { email, password, confirmPassword, firstName, lastName, username } =
      req.body;
    const requestIP = getClientIP(req);

    // Валидация обязательных полей
    if (!email || !password || !firstName) {
      return res.status(400).json(
        formatResponse(false, null, "Email, heslo a meno sú povinné", {
          type: "VALIDATION_ERROR",
          fields: ["email", "password", "firstName"],
        })
      );
    }

    // Проверка совпадения паролей
    if (password !== confirmPassword) {
      return res.status(400).json(
        formatResponse(false, null, "Heslá sa nezhodujú", {
          type: "VALIDATION_ERROR",
          field: "confirmPassword",
        })
      );
    }

    // Валидация пароля
    if (password.length < 6) {
      return res.status(400).json(
        formatResponse(false, null, "Heslo musí obsahovať minimálne 6 znakov", {
          type: "VALIDATION_ERROR",
          field: "password",
        })
      );
    }

    // Валидация email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json(
        formatResponse(false, null, "Nesprávny formát emailu", {
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
          "Používateľské meno musí obsahovať minimálne 3 znaky (písmená, čísla, _)",
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
            // ...(result.devCode && { devCode: result.devCode }),
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

  // Вход пользователя - ЗАВЕРШАЕМ
  login = asyncHandler(async (req, res) => {
    const { login, password } = req.body;

    // Валидация обязательных полей
    if (!login || !password) {
      return res.status(400).json(
        formatResponse(false, null, "Prihlasovacie meno a heslo sú povinné", {
          type: "VALIDATION_ERROR",
          fields: ["login", "password"],
        })
      );
    }

    try {
      const result = await authService.loginUser({ login, password });

      // Проверяем подтверждение email для локальных пользователей
      if (result.user.provider === "local" && !result.user.isEmailVerified) {
        return res.status(403).json(
          formatResponse(false, null, "Je potrebné potvrdiť email", {
            type: "EMAIL_NOT_VERIFIED",
            userId: result.user._id,
            email: result.user.email,
          })
        );
      }

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
          "Úspešné prihlásenie do systému"
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

  // Отправка кода подтверждения email - ЗАВЕРШАЕМ
  sendVerificationCode = asyncHandler(async (req, res) => {
    const { email } = req.body;
    const requestIP = getClientIP(req);

    if (!email) {
      return res.status(400).json(
        formatResponse(false, null, "Email je povinný", {
          type: "VALIDATION_ERROR",
          field: "email",
        })
      );
    }

    // Валидация email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json(
        formatResponse(false, null, "Nesprávny formát emailu", {
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
          "code",
          "FastCredit",
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

  // Подтверждение email - ЗАВЕРШАЕМ
  verifyEmail = asyncHandler(async (req, res) => {
    const { email, code } = req.body;
    const requestIP = getClientIP(req);

    if (!email || !code) {
      return res.status(400).json(
        formatResponse(false, null, "Email a overovací kód sú povinné", {
          type: "VALIDATION_ERROR",
          fields: ["email", "code"],
        })
      );
    }

    // Валидация кода (должен быть 6 цифр)
    if (!/^[0-9]{6}$/.test(code)) {
      return res.status(400).json(
        formatResponse(false, null, "Kód musí obsahovať 6 číslic", {
          type: "VALIDATION_ERROR",
          field: "code",
        })
      );
    }

    try {
      const result = await verificationService.verifyEmailCode(
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

      // Если email уже был подтвержден
      if (result.alreadyVerified) {
        return res.json(
          formatResponse(true, { alreadyVerified: true }, result.message)
        );
      }

      // Генерируем токен для подтвержденного пользователя
      const user = result.user;
      const token = authService.generateInternalToken({ _id: user.id });
      const userInfo = await authService.getUserInfo(user.id);

      await emailService.sendEmail(email, "welcome", "FastCredit", { code: 1 });

      logUserAction(
        user.id,
        "EMAIL_VERIFIED_SUCCESS",
        `Email verified and user logged in: ${email}`
      );

      res.json(
        formatResponse(
          true,
          {
            ...userInfo,
            token,
            emailVerified: true,
          },
          "Email bol úspešne overený. Vitajte!"
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

  // ==================== ВОССТАНОВЛЕНИЕ ПАРОЛЯ ====================

  // Запрос кода сброса пароля - ДОБАВЛЯЕМ
  requestPasswordReset = asyncHandler(async (req, res) => {
    const { email } = req.body;
    const requestIP = getClientIP(req);

    if (!email) {
      return res.status(400).json(
        formatResponse(false, null, "Email je povinný", {
          type: "VALIDATION_ERROR",
          field: "email",
        })
      );
    }

    // Валидация email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json(
        formatResponse(false, null, "Nesprávny formát emailu", {
          type: "VALIDATION_ERROR",
          field: "email",
        })
      );
    }

    try {
      const result = await authService.requestPasswordReset(email, requestIP);

      if (!result.success) {
        return res.status(400).json(
          formatResponse(false, null, result.message, {
            type: result.error,
            ...(result.timeUntilExpiry && {
              timeUntilExpiry: result.timeUntilExpiry,
            }),
          })
        );
      }

      res.json(
        formatResponse(
          true,
          {
            sent: true,
            expiresAt: result.expiresAt,
            ...(result.devCode && { devCode: result.devCode }),
          },
          result.message
        )
      );
    } catch (error) {
      throw error;
    }
  });

  // Проверка кода сброса пароля - ДОБАВЛЯЕМ
  verifyResetCode = asyncHandler(async (req, res) => {
    const { email, code } = req.body;
    const requestIP = getClientIP(req);

    if (!email || !code) {
      return res.status(400).json(
        formatResponse(false, null, "Email a kód sú povinné", {
          type: "VALIDATION_ERROR",
          fields: ["email", "code"],
        })
      );
    }

    // Валидация кода
    if (!/^[0-9]{6}$/.test(code)) {
      return res.status(400).json(
        formatResponse(false, null, "Kód musí obsahovať 6 číslic", {
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
            resetToken: result.resetToken,
          },
          result.message
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

  // Сброс пароля по коду - ДОБАВЛЯЕМ
  resetPassword = asyncHandler(async (req, res) => {
    const { email, code, newPassword, confirmPassword } = req.body;
    const requestIP = getClientIP(req);

    if (!email || !code || !newPassword || !confirmPassword) {
      return res.status(400).json(
        formatResponse(false, null, "Všetky polia sú povinné", {
          type: "VALIDATION_ERROR",
          fields: ["email", "code", "newPassword", "confirmPassword"],
        })
      );
    }

    // Проверка совпадения паролей
    if (newPassword !== confirmPassword) {
      return res.status(400).json(
        formatResponse(false, null, "Heslá sa nezhodujú", {
          type: "VALIDATION_ERROR",
          field: "confirmPassword",
        })
      );
    }

    // Валидация пароля
    if (newPassword.length < 6) {
      return res.status(400).json(
        formatResponse(false, null, "Heslo musí obsahovať minimálne 6 znakov", {
          type: "VALIDATION_ERROR",
          field: "newPassword",
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

      res.json(formatResponse(true, null, result.message));
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

  // ==================== ЗАЩИЩЕННЫЕ РОУТЫ ====================

  // Получение текущего пользователя - ДОБАВЛЯЕМ
  getCurrentUser = asyncHandler(async (req, res) => {
    try {
      const userInfo = await authService.getUserInfo(req.user._id);

      res.json(
        formatResponse(
          true,
          userInfo,
          "Informácie o používateľovi boli získané"
        )
      );
    } catch (error) {
      if (error.message === "USER_NOT_FOUND") {
        return res.status(404).json(
          formatResponse(false, null, "Používateľ nebol nájdený", {
            type: "USER_NOT_FOUND",
          })
        );
      }

      throw error;
    }
  });

  // Обновление профиля - ДОБАВЛЯЕМ
  updateProfile = asyncHandler(async (req, res) => {
    const { username, bio } = req.body;

    try {
      const updatedUser = await authService.updateUserProfile(req.user._id, {
        username,
        bio,
      });

      res.json(
        formatResponse(true, updatedUser, "Profil bol úspešne aktualizovaný")
      );
    } catch (error) {
      if (error.message.includes("не найден")) {
        return res.status(404).json(
          formatResponse(false, null, error.message, {
            type: "USER_NOT_FOUND",
          })
        );
      }

      if (error.message.includes("уже занят")) {
        return res.status(409).json(
          formatResponse(false, null, error.message, {
            type: "USERNAME_TAKEN",
          })
        );
      }

      throw error;
    }
  });

  // Проверка прав доступа - ДОБАВЛЯЕМ
  checkPermissions = asyncHandler(async (req, res) => {
    const user = req.user;

    res.json(
      formatResponse(
        true,
        {
          role: user.role,
          permissions: {
            canCreateQuestions: user.canAccessFeatures(),
            canAnswerQuestions: user.isExpert(),
            canModerateContent: user.isAdmin(),
            canAccessAdminPanel: user.isAdmin(),
            canManageUsers: user.isAdmin(),
          },
          status: {
            isActive: user.isActive,
            isEmailVerified: user.isEmailVerified,
            isBanned: user.isBannedCurrently(),
            isLocked: user.isAccountLocked(),
          },
        },
        "Prístupové práva boli získané"
      )
    );
  });

  // Выход из системы - ДОБАВЛЯЕМ
  logout = asyncHandler(async (req, res) => {
    try {
      logUserAction(
        req.user._id,
        "LOGOUT",
        `User logged out: ${req.user.email}`
      );

      res.json(formatResponse(true, null, "Odhlásenie bolo úspešné"));
    } catch (error) {
      throw error;
    }
  });

  // ==================== СТАТИСТИКА ====================

  // Статистика аутентификации (для админов) - ДОБАВЛЯЕМ
  getAuthStatistics = asyncHandler(async (req, res) => {
    try {
      const userStats = await userService.getUserStatistics();
      const verificationStats =
        await verificationService.getVerificationStatistics();

      res.json(
        formatResponse(
          true,
          {
            users: userStats,
            verificationCodes: verificationStats,
          },
          "Štatistika autentifikácie bola získaná"
        )
      );
    } catch (error) {
      throw error;
    }
  });

  // Проверка здоровья auth сервиса - ДОБАВЛЯЕМ
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
        "Auth služba funguje normálne"
      )
    );
  });
}

export default new AuthController();
