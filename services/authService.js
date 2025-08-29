// services/authService.js
import jwt from "jsonwebtoken";
import config from "../config/index.js";
import User from "../models/User.js";
import { comparePassword } from "../utils/security.js";
import verificationService from "./verificationService.js";
import {
  logUserAction,
  logError,
  logSecurityEvent,
} from "../middlewares/logger.js";
import { OAuth2Client } from "google-auth-library";
import { USER_ROLES } from "../utils/constants.js";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

class AuthService {
  // ==================== GOOGLE OAUTH МЕТОДЫ ====================

  // Верификация токена из внешнего микросервиса (Google ID Token + фолбэк на локальный JWT)
  async verifyExternalToken(token) {
    try {
      // 1) Пытаемся проверить как Google ID Token
      const ticket = await googleClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const p = ticket.getPayload();

      // Доп. проверка издателя
      if (
        p.iss !== "accounts.google.com" &&
        p.iss !== "https://accounts.google.com"
      ) {
        throw new Error("INVALID_ISSUER");
      }

      const normalized = {
        userId: p.sub, // стабильный Google ID
        email: p.email,
        isVerified: !!p.email_verified,
        avatar: p.picture || null,
        name: p.name || null,
      };

      logUserAction(
        normalized.userId,
        "TOKEN_VERIFIED",
        "Google ID token verified"
      );

      return { success: true, payload: normalized, type: "google" };
    } catch (googleErr) {
      // 2) Фолбэк: поддержим локальный JWT по JWT_SECRET
      try {
        const decoded = jwt.verify(token, config.JWT_SECRET);
        logUserAction(
          decoded.userId || decoded.id,
          "TOKEN_VERIFIED",
          "Local JWT verified (fallback)"
        );
        return { success: true, payload: decoded, type: "local" };
      } catch (localErr) {
        logSecurityEvent(
          "INVALID_EXTERNAL_TOKEN",
          `Token verification failed: ${
            googleErr?.message || localErr?.message
          }`,
          null,
          null
        );
        return { success: false, error: "INVALID_TOKEN" };
      }
    }
  }

  // Получение или создание пользователя из Google токена (старый метод)
  async getUserFromToken(token) {
    try {
      const verification = await this.verifyExternalToken(token);

      if (!verification.success) {
        throw new Error(verification.error);
      }

      const { payload } = verification;
      const googleId = payload.userId || payload.id; // у Google это sub
      const userEmail = payload.email;

      if (!googleId || !userEmail) {
        throw new Error("Invalid token payload: missing googleId or email");
      }

      // 1) Ищем пользователя по googleId
      let user = await User.findOne({ googleId }).select("-__v");

      // 2) Если не нашли по googleId, ищем по email (миграция старых пользователей)
      if (!user) {
        user = await User.findOne({ email: userEmail }).select("-__v");

        if (user && !user.googleId) {
          // Привязываем Google ID к существующему аккаунту
          user.googleId = googleId;
          user.provider = "google";
          user.isEmailVerified = true;
          await user.save();

          logUserAction(
            user._id,
            "GOOGLE_LINKED",
            `Linked Google ID to existing account`
          );
        }
      }

      // 3) Если пользователя вообще нет - создаем нового
      if (!user) {
        user = await User.create({
          googleId,
          email: userEmail,
          provider: "google",
          role: USER_ROLES.USER,
          isEmailVerified: true,
          isVerified: true,
          avatar: payload.avatar,
          firstName: payload.name?.split(" ")[0],
          lastName: payload.name?.split(" ").slice(1).join(" "),
          isActive: true,
        });

        logUserAction(
          user._id,
          "USER_CREATED_GOOGLE",
          `New user created via Google OAuth`
        );
      } else {
        // 4) Обновляем данные существующего пользователя
        const updateData = {};
        if (payload.avatar && user.avatar !== payload.avatar) {
          updateData.avatar = payload.avatar;
        }
        if (!user.isEmailVerified && payload.isVerified) {
          updateData.isEmailVerified = true;
          updateData.isVerified = true;
        }

        if (Object.keys(updateData).length > 0) {
          user = await User.findByIdAndUpdate(user._id, updateData, {
            new: true,
          });
          logUserAction(
            user._id,
            "USER_UPDATED_FROM_TOKEN",
            `User data updated: ${JSON.stringify(updateData)}`
          );
        }

        // обновляем время последнего входа
        user.lastLoginAt = new Date();
        await user.save({ validateBeforeSave: false });
      }

      return user;
    } catch (error) {
      logError(error, "AuthService.getUserFromToken");
      throw error;
    }
  }

  // ==================== ЛОКАЛЬНАЯ АВТОРИЗАЦИЯ ====================

  // Регистрация нового пользователя
  async registerUser(userData, requestIP = null) {
    try {
      const { email, password, firstName, lastName, username } = userData;

      // Проверяем существование пользователя по email
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        throw new Error("USER_ALREADY_EXISTS");
      }

      // Проверяем уникальность username если указан
      if (username) {
        const existingUsername = await User.findOne({ username });
        if (existingUsername) {
          throw new Error("USERNAME_TAKEN");
        }
      }

      // Создаем пользователя (пароль автоматически захешируется в pre-save модели)
      const user = await User.create({
        email,
        password,
        firstName,
        lastName,
        username,
        provider: "local",
        role: USER_ROLES.USER,
        isEmailVerified: false, // требует подтверждения email
        isVerified: false,
        isActive: true,
      });

      logUserAction(
        user._id,
        "USER_REGISTERED",
        `New user registered: ${email}`
      );

      // Отправляем код подтверждения email
      let verificationResult;
      try {
        verificationResult =
          await verificationService.sendEmailVerificationCode(email, requestIP);
      } catch (verificationError) {
        logError(
          verificationError,
          "AuthService.registerUser - verification code send failed",
          user._id
        );
        verificationResult = { success: false };
      }

      return {
        user,
        verificationSent: verificationResult.success,
        message: verificationResult.success
          ? "Пользователь зарегистрирован. Код подтверждения отправлен на email."
          : "Пользователь зарегистрирован. Ошибка отправки кода подтверждения.",
        ...(process.env.NODE_ENV === "development" &&
          verificationResult.devCode && {
            devCode: verificationResult.devCode, // Для тестирования
          }),
      };
    } catch (error) {
      logError(error, "AuthService.registerUser");

      if (error.message === "USER_ALREADY_EXISTS") {
        throw new Error("Пользователь с таким email уже существует");
      }
      if (error.message === "USERNAME_TAKEN") {
        throw new Error("Имя пользователя уже занято");
      }

      throw error;
    }
  }

  // Вход пользователя по email/username + password
  async loginUser(credentials) {
    try {
      const { login, password } = credentials; // login может быть email или username

      if (!login || !password) {
        throw new Error("LOGIN_PASSWORD_REQUIRED");
      }

      // Ищем пользователя по email или username, включая пароль в выборку
      const user = await User.findOne({
        $or: [{ email: login.toLowerCase() }, { username: login }],
        provider: "local", // только локальные пользователи
      }).select("+password +loginAttempts +lockUntil");

      if (!user) {
        logSecurityEvent(
          "LOGIN_FAILED",
          `Login attempt with non-existent credentials: ${login}`,
          null
        );
        throw new Error("INVALID_CREDENTIALS");
      }

      // Проверяем блокировку аккаунта
      if (user.isAccountLocked) {
        logSecurityEvent(
          "LOGIN_BLOCKED",
          `Login attempt on locked account: ${user.email}`,
          user._id
        );
        throw new Error("ACCOUNT_LOCKED");
      }

      // Проверяем пароль с помощью security.js
      const isPasswordValid = await comparePassword(password, user.password);

      if (!isPasswordValid) {
        // Увеличиваем счетчик неудачных попыток
        await user.incLoginAttempts();

        logSecurityEvent(
          "LOGIN_FAILED",
          `Invalid password for user: ${user.email}`,
          user._id
        );
        throw new Error("INVALID_CREDENTIALS");
      }

      // Сбрасываем счетчик попыток при успешном входе
      if (user.loginAttempts > 0) {
        await user.resetLoginAttempts();
      }

      // Проверяем статус пользователя
      const statusCheck = await this.validateUserStatus(user);
      if (!statusCheck.valid) {
        throw new Error(statusCheck.reason);
      }

      // Обновляем время последнего входа
      user.lastLoginAt = new Date();
      await user.save();

      logUserAction(user._id, "LOGIN_SUCCESS", `User logged in: ${user.email}`);

      return {
        user,
        token: this.generateInternalToken(user),
      };
    } catch (error) {
      logError(error, "AuthService.loginUser");

      if (error.message === "LOGIN_PASSWORD_REQUIRED") {
        throw new Error("Логин и пароль обязательны");
      }
      if (error.message === "INVALID_CREDENTIALS") {
        throw new Error("Неверный email/логин или пароль");
      }
      if (error.message === "ACCOUNT_LOCKED") {
        throw new Error(
          "Аккаунт временно заблокирован из-за множественных неудачных попыток входа"
        );
      }

      throw error;
    }
  }

  // Отправка кода подтверждения email
  async sendEmailVerificationCode(email, requestIP = null) {
    try {
      const result = await verificationService.sendEmailVerificationCode(
        email,
        requestIP
      );
      return result;
    } catch (error) {
      logError(error, "AuthService.sendEmailVerificationCode");
      throw error;
    }
  }

  // Подтверждение email по коду
  async verifyEmail(email, verificationCode, requestIP = null) {
    try {
      const result = await verificationService.verifyEmailCode(
        email,
        verificationCode,
        requestIP
      );
      return result;
    } catch (error) {
      logError(error, "AuthService.verifyEmail");
      throw error;
    }
  }

  // Запрос сброса пароля
  async requestPasswordReset(email, requestIP = null) {
    try {
      const result = await verificationService.sendPasswordResetCode(
        email,
        requestIP
      );
      return result;
    } catch (error) {
      logError(error, "AuthService.requestPasswordReset");
      throw error;
    }
  }

  // Проверка кода сброса пароля (промежуточный шаг)
  async verifyPasswordResetCode(email, code, requestIP = null) {
    try {
      const result = await verificationService.verifyPasswordResetCode(
        email,
        code,
        requestIP
      );
      return result;
    } catch (error) {
      logError(error, "AuthService.verifyPasswordResetCode");
      throw error;
    }
  }

  // Сброс пароля по коду
  async resetPassword(email, code, newPassword, requestIP = null) {
    try {
      const result = await verificationService.resetPasswordWithCode(
        email,
        code,
        newPassword,
        requestIP
      );
      return result;
    } catch (error) {
      logError(error, "AuthService.resetPassword");

      if (error.message.includes("найден")) {
        throw new Error("Пользователь не найден");
      }

      throw error;
    }
  }

  // ==================== ОБЩИЕ МЕТОДЫ ====================

  // Проверка статуса пользователя после получения из токена
  async validateUserStatus(user) {
    try {
      // Проверяем активность аккаунта
      if (!user.isActive) {
        logSecurityEvent(
          "INACTIVE_USER_LOGIN",
          "Inactive user attempted login",
          user._id
        );
        return {
          valid: false,
          reason: "ACCOUNT_INACTIVE",
          message: "Аккаунт деактивирован",
        };
      }

      // Проверяем блокировку
      if (user.isBannedCurrently()) {
        const banInfo = {
          reason: user.bannedReason,
          until: user.bannedUntil,
          isPermanent: !user.bannedUntil,
        };

        logSecurityEvent(
          "BANNED_USER_LOGIN",
          `Banned user attempted login: ${JSON.stringify(banInfo)}`,
          user._id
        );

        return {
          valid: false,
          reason: "ACCOUNT_BANNED",
          message: banInfo.isPermanent
            ? `Аккаунт заблокирован навсегда. Причина: ${banInfo.reason}`
            : `Аккаунт заблокирован до ${banInfo.until.toLocaleDateString()}. Причина: ${
                banInfo.reason
              }`,
          banInfo,
        };
      }

      return {
        valid: true,
        user,
      };
    } catch (error) {
      logError(error, "AuthService.validateUserStatus", user?._id);
      throw error;
    }
  }

  // Генерация JWT токена для внутреннего использования
  generateInternalToken(user) {
    try {
      const payload = {
        userId: user._id,
        email: user.email,
        role: user.role,
        provider: user.provider,
        isVerified: user.isEmailVerified,
      };

      const token = jwt.sign(payload, config.JWT_SECRET, {
        expiresIn: config.JWT_EXPIRES_IN || "24h",
      });

      logUserAction(
        user._id,
        "INTERNAL_TOKEN_GENERATED",
        "Internal JWT token generated"
      );

      return token;
    } catch (error) {
      logError(error, "AuthService.generateInternalToken", user?._id);
      throw error;
    }
  }

  // Получение информации о пользователе
  async getUserInfo(userId) {
    try {
      const user = await User.findById(userId).select("-__v");

      if (!user) {
        throw new Error("User not found");
      }

      // Возвращаем безопасную информацию о пользователе
      return {
        id: user._id,
        email: user.email,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        provider: user.provider,
        role: user.role,
        isVerified: user.isEmailVerified,
        avatar: user.avatar,
        bio: user.bio,
        rating: user.rating,
        totalAnswers: user.totalAnswers,
        totalQuestions: user.totalQuestions,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        // Виртуальные поля
        isExpert: user.isExpert,
        isAdmin: user.isAdmin,
        canAnswer: user.canAnswer,
        canModerate: user.canModerate,
      };
    } catch (error) {
      logError(error, "AuthService.getUserInfo", userId);
      throw error;
    }
  }

  // Обновление профиля пользователя
  async updateUserProfile(userId, updateData) {
    try {
      const user = await User.findById(userId);

      if (!user) {
        throw new Error("User not found");
      }

      // Разрешенные поля для обновления обычными пользователями
      const allowedFields = [
        "bio",
        "avatar",
        "firstName",
        "lastName",
        "username",
      ];
      const filteredData = {};

      allowedFields.forEach((field) => {
        if (updateData[field] !== undefined) {
          filteredData[field] = updateData[field];
        }
      });

      // Проверка уникальности username если обновляется
      if (updateData.username && updateData.username !== user.username) {
        const usernameExists = await User.findOne({
          username: updateData.username,
          _id: { $ne: userId },
        });

        if (usernameExists) {
          throw new Error("Username already taken");
        }
      }

      if (Object.keys(filteredData).length === 0) {
        throw new Error("No valid fields to update");
      }

      const updatedUser = await User.findByIdAndUpdate(userId, filteredData, {
        new: true,
        runValidators: true,
      });

      logUserAction(
        userId,
        "PROFILE_UPDATED",
        `Updated fields: ${Object.keys(filteredData).join(", ")}`
      );

      return updatedUser;
    } catch (error) {
      logError(error, "AuthService.updateUserProfile", userId);

      if (error.message === "Username already taken") {
        throw new Error("Имя пользователя уже занято");
      }

      throw error;
    }
  }

  // Проверка прав доступа пользователя
  async checkUserPermissions(userId, requiredRole = null) {
    try {
      const user = await User.findById(userId);

      if (!user) {
        return { hasAccess: false, reason: "USER_NOT_FOUND" };
      }

      if (!user.isActive) {
        return { hasAccess: false, reason: "ACCOUNT_INACTIVE" };
      }

      if (user.isBannedCurrently()) {
        return { hasAccess: false, reason: "ACCOUNT_BANNED" };
      }

      if (requiredRole && user.role !== requiredRole) {
        const roleHierarchy = { user: 1, expert: 2, admin: 3 };
        const userLevel = roleHierarchy[user.role] || 0;
        const requiredLevel = roleHierarchy[requiredRole] || 0;

        if (userLevel < requiredLevel) {
          return { hasAccess: false, reason: "INSUFFICIENT_ROLE" };
        }
      }

      return {
        hasAccess: true,
        user: user,
        permissions: {
          canAnswer: user.canAnswer,
          canModerate: user.canModerate,
          isExpert: user.isExpert,
          isAdmin: user.isAdmin,
        },
      };
    } catch (error) {
      logError(error, "AuthService.checkUserPermissions", userId);
      throw error;
    }
  }
}

export default new AuthService();
