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
import cryptoService from "../services/cryptoService.js";

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
      const payload = ticket.getPayload();

      // Доп. проверка издателя
      if (
        payload.iss !== "accounts.google.com" &&
        payload.iss !== "https://accounts.google.com"
      ) {
        throw new Error("INVALID_ISSUER");
      }

      const normalized = {
        userId: payload.sub, // стабильный Google ID
        email: payload.email,
        isVerified: payload.email_verified,
        firstName: payload.given_name,
        lastName: payload.family_name,
        avatar: payload.picture,
        provider: "google",
      };

      return { type: "google", data: normalized };
    } catch (googleError) {
      // 2) Если не Google токен, проверяем как локальный JWT
      try {
        const decoded = jwt.verify(token, config.JWT_SECRET);
        return { type: "jwt", data: decoded };
      } catch (jwtError) {
        if (jwtError.name === "TokenExpiredError") {
          throw new Error("TOKEN_EXPIRED");
        }
        if (jwtError.name === "JsonWebTokenError") {
          throw new Error("INVALID_TOKEN");
        }
        throw new Error("INVALID_TOKEN");
      }
    }
  }

  // Получение пользователя из токена (ДОБАВЛЕНО - ОТСУТСТВОВАЛО!)
  async getUserFromToken(token) {
    try {
      const tokenData = await this.verifyExternalToken(token);

      if (tokenData.type === "google") {
        // Ищем или создаем Google пользователя
        let user = await User.findOne({
          googleId: tokenData.data.userId,
        });

        if (!user) {
          const hashedEmail = await cryptoService.hashData(
            tokenData.data.email
          );
          // Проверяем существование пользователя с таким же email
          const existingUser = await User.findOne({
            email: hashedEmail,
          });

          if (existingUser) {
            throw new Error("EMAIL_ALREADY_EXISTS");
          }

          // Создаем нового Google пользователя
          user = await User.create({
            googleId: tokenData.data.userId,
            email: hashedEmail,
            originalEmail: tokenData.data.email,
            firstName: tokenData.data.firstName,
            lastName: tokenData.data.lastName,
            avatar: tokenData.data.avatar,
            provider: "google",
            isEmailVerified: true,
            isVerified: true,
            role: USER_ROLES.USER,
            lastLoginAt: new Date(),
          });

          logUserAction(
            user._id,
            "GOOGLE_USER_CREATED",
            `New Google user created: ${user.email}`
          );
        } else {
          // Обновляем последний вход
          user.lastLoginAt = new Date();
          await user.save();
        }

        return user;
      } else if (tokenData.type === "jwt") {
        // Ищем локального пользователя по JWT
        const user = await User.findById(
          tokenData.data.userId || tokenData.data.id
        );

        if (!user) {
          throw new Error("USER_NOT_FOUND");
        }

        return user;
      }

      throw new Error("INVALID_TOKEN_TYPE");
    } catch (error) {
      logError(error, "AuthService.getUserFromToken");
      throw error;
    }
  }

  // Проверка статуса пользователя (ДОБАВЛЕНО - ОТСУТСТВОВАЛО!)
  async validateUserStatus(user) {
    try {
      // Проверяем активность аккаунта
      if (!user.isActive) {
        return {
          valid: false,
          reason: "ACCOUNT_INACTIVE",
          message: "Аккаунт деактивирован",
        };
      }

      // Проверяем блокировку аккаунта
      if (user.isAccountLocked()) {
        const lockTimeLeft = Math.ceil(
          (user.lockUntil - Date.now()) / 1000 / 60
        );
        return {
          valid: false,
          reason: "ACCOUNT_LOCKED",
          message: `Аккаунт заблокирован на ${lockTimeLeft} минут`,
          lockUntil: user.lockUntil,
        };
      }

      // Проверяем бан
      if (user.isBannedCurrently()) {
        const banInfo = {
          isPermanent: !user.bannedUntil,
          bannedUntil: user.bannedUntil,
          reason: user.bannedReason,
        };

        return {
          valid: false,
          reason: "USER_BANNED",
          message: user.bannedUntil
            ? `Пользователь забанен до ${user.bannedUntil.toLocaleString()}`
            : "Пользователь забанен навсегда",
          banInfo,
        };
      }

      return { valid: true };
    } catch (error) {
      logError(error, "AuthService.validateUserStatus");
      return {
        valid: false,
        reason: "VALIDATION_ERROR",
        message: "Ошибка проверки статуса пользователя",
      };
    }
  }

  // Генерация внутреннего JWT токена (ДОБАВЛЕНО - ОТСУТСТВОВАЛО!)
  generateInternalToken(user) {
    try {
      const payload = {
        userId: user._id,
        id: user._id, // для совместимости
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        provider: user.provider,
        iat: Math.floor(Date.now() / 1000),
      };

      return jwt.sign(payload, config.JWT_SECRET, {
        expiresIn: config.JWT_EXPIRATION || "7d",
        issuer: "fastcredit-forum",
        audience: "fastcredit-users",
      });
    } catch (error) {
      logError(error, "AuthService.generateInternalToken");
      throw new Error("Ошибка генерации токена");
    }
  }

  // Получение информации о пользователе (ДОБАВЛЕНО - ОТСУТСТВОВАЛО!)
  async getUserInfo(userId) {
    try {
      const user = await User.findById(userId).select("-__v");
      await cryptoService.smartDecrypt(user);

      if (!user) {
        throw new Error("USER_NOT_FOUND");
      }

      return {
        id: user._id,
        email: user.originalEmail,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        displayName: user.displayName,
        role: user.role,
        provider: user.provider,
        isEmailVerified: user.isEmailVerified,
        isActive: user.isActive,
        avatar: user.avatar,
        bio: user.bio,
        rating: user.rating,
        totalAnswers: user.totalAnswers,
        totalQuestions: user.totalQuestions,
        canAccessFeatures: user.canAccessFeatures(),
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      };
    } catch (error) {
      logError(error, "AuthService.getUserInfo");
      throw error;
    }
  }

  // ==================== ЛОКАЛЬНАЯ АВТОРИЗАЦИЯ ====================

  // Регистрация локального пользователя (ДОБАВЛЕНО - ОТСУТСТВОВАЛО!)
  async registerUser(userData, requestIP = null) {
    try {
      const { email, password, firstName, lastName, username } = userData;

      const hashedEmail = await cryptoService.hashData(email);

      // Проверяем существование пользователя с таким email
      const existingEmailUser = await User.findOne({ email: hashedEmail });
      if (existingEmailUser) {
        throw new Error("EMAIL_EXISTS");
      }

      // Проверяем существование пользователя с таким username (если указан)
      if (username) {
        const existingUsernameUser = await User.findOne({ username });
        if (existingUsernameUser) {
          throw new Error("USERNAME_EXISTS");
        }
      }

      // Создаем пользователя
      const user = await User.create({
        email: hashedEmail,
        originalEmail: email,
        password, // автоматически хешируется в pre-save middleware
        firstName,
        lastName,
        username,
        provider: "local",
        role: USER_ROLES.USER,
        isEmailVerified: false,
        isVerified: false,
        isActive: true,
      });

      logUserAction(
        user._id,
        "USER_REGISTERED",
        `New local user registered: ${email}`
      );

      // Автоматически отправляем код подтверждения
      let verificationResult = null;
      try {
        verificationResult =
          await verificationService.sendEmailVerificationCode(email, requestIP);

        console.log("verificationResult", verificationResult);
      } catch (verificationError) {
        logError(verificationError, "AuthService.registerUser - verification");
        // Не блокируем регистрацию, если код не отправился
      }

      return {
        user,
        verificationSent: verificationResult?.success || false,
        message: "Пользователь создан. Проверьте email для подтверждения.",
        ...(verificationResult?.devCode && {
          devCode: verificationResult.devCode,
        }),
      };
    } catch (error) {
      logError(error, "AuthService.registerUser");

      if (error.message === "EMAIL_EXISTS") {
        throw new Error("Пользователь с таким email уже существует");
      }
      if (error.message === "USERNAME_EXISTS") {
        throw new Error("Пользователь с таким username уже существует");
      }
      if (error.code === 11000) {
        // MongoDB duplicate key error
        if (error.keyPattern?.email) {
          throw new Error("Email уже занят");
        }
        if (error.keyPattern?.username) {
          throw new Error("Username уже занят");
        }
      }

      throw error;
    }
  }

  // Вход локального пользователя (ЗАВЕРШАЕМ МЕТОД)
  async loginUser({ login, password }) {
    try {
      if (!login || !password) {
        throw new Error("LOGIN_PASSWORD_REQUIRED");
      }

      // Ищем пользователя по email или username с паролем
      const user = await User.findByEmailOrUsername(login, true);

      if (!user) {
        logSecurityEvent(
          "LOGIN_FAILED",
          `Login attempt with non-existent user: ${login}`,
          null
        );
        throw new Error("INVALID_CREDENTIALS");
      }

      // Проверяем блокировку аккаунта
      if (user.isAccountLocked()) {
        const lockTimeLeft = Math.ceil(
          (user.lockUntil - Date.now()) / 1000 / 60
        );

        logSecurityEvent(
          "LOGIN_BLOCKED",
          `Login attempt on locked account: ${user.email}`,
          user._id,
          lockTimeLeft
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
      throw error;
    }
  }

  // ==================== УТИЛИТЫ ====================

  // Проверка доступности email
  async checkEmailAvailability(email) {
    try {
      const hashedEmail = await cryptoService.hashData(email);
      const existingUser = await User.findOne({ email: hashedEmail });
      return {
        available: !existingUser,
        message: existingUser ? "Email уже занят" : "Email доступен",
      };
    } catch (error) {
      logError(error, "AuthService.checkEmailAvailability");
      throw error;
    }
  }

  // Проверка доступности username
  async checkUsernameAvailability(username) {
    try {
      const existingUser = await User.findOne({ username });
      return {
        available: !existingUser,
        message: existingUser ? "Username уже занят" : "Username доступен",
      };
    } catch (error) {
      logError(error, "AuthService.checkUsernameAvailability");
      throw error;
    }
  }

  // Обновление профиля пользователя (ДОБАВЛЕНО - ОТСУТСТВОВАЛО!)
  async updateUserProfile(userId, updateData) {
    try {
      const user = await User.findById(userId);

      if (!user) {
        throw new Error("USER_NOT_FOUND");
      }

      // Разрешенные поля для обновления
      const allowedFields = ["username", "bio", "avatar"];

      const updateObject = {};
      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          updateObject[field] = updateData[field];
        }
      }

      // Проверяем уникальность username если он обновляется
      if (updateObject.username) {
        const existingUser = await User.findOne({
          username: updateObject.username,
          _id: { $ne: userId },
        });

        if (existingUser) {
          throw new Error("USERNAME_EXISTS");
        }
      }

      const updatedUser = await User.findByIdAndUpdate(userId, updateObject, {
        new: true,
        runValidators: true,
      });

      logUserAction(
        userId,
        "PROFILE_UPDATED",
        `Profile updated: ${Object.keys(updateObject).join(", ")}`
      );

      return await this.getUserInfo(userId);
    } catch (error) {
      logError(error, "AuthService.updateUserProfile");

      if (error.message === "USER_NOT_FOUND") {
        throw new Error("Пользователь не найден");
      }
      if (error.message === "USERNAME_EXISTS") {
        throw new Error("Username уже занят");
      }

      throw error;
    }
  }
}

export default new AuthService();
