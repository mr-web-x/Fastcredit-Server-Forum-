// services/authService.js
import jwt from "jsonwebtoken";
import config from "../config/index.js";
import User from "../models/User.js";
import {
  logUserAction,
  logError,
  logSecurityEvent,
} from "../middlewares/logger.js";

class AuthService {
  // Верификация токена из внешнего микросервиса авторизации
  async verifyExternalToken(token) {
    try {
      // Здесь будет запрос к внешнему микросервису авторизации
      // Пока что проверяем JWT токен локально
      const decoded = jwt.verify(token, config.JWT_SECRET);

      logUserAction(
        decoded.userId || decoded.id,
        "TOKEN_VERIFIED",
        `External token verified`
      );

      return {
        success: true,
        payload: decoded,
      };
    } catch (error) {
      logSecurityEvent(
        "INVALID_EXTERNAL_TOKEN",
        `Token verification failed: ${error.message}`,
        null,
        null
      );

      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Получение или создание пользователя из токена
  async getUserFromToken(token) {
    try {
      const verification = await this.verifyExternalToken(token);

      if (!verification.success) {
        throw new Error(verification.error);
      }

      const { payload } = verification;
      const userId = payload.userId || payload.id;
      const userEmail = payload.email;

      if (!userId || !userEmail) {
        throw new Error("Invalid token payload: missing userId or email");
      }

      // Ищем пользователя в нашей базе
      let user = await User.findById(userId);

      // Если пользователя нет, создаем его (первый вход)
      if (!user) {
        user = await User.create({
          _id: userId,
          email: userEmail,
          role: "user", // все регистрируются как обычные пользователи
          isVerified: payload.isVerified || false,
          avatar: payload.avatar || null,
        });

        logUserAction(
          userId,
          "USER_CREATED_FROM_TOKEN",
          `New user created from external auth: ${userEmail}`
        );
      } else {
        // Обновляем информацию пользователя при каждом входе
        const updateData = {};

        if (payload.email && payload.email !== user.email) {
          updateData.email = payload.email;
        }

        if (
          payload.isVerified !== undefined &&
          payload.isVerified !== user.isVerified
        ) {
          updateData.isVerified = payload.isVerified;
        }

        if (payload.avatar && payload.avatar !== user.avatar) {
          updateData.avatar = payload.avatar;
        }

        if (Object.keys(updateData).length > 0) {
          await User.findByIdAndUpdate(userId, updateData, { new: true });
          user = await User.findById(userId);
          logUserAction(
            userId,
            "USER_UPDATED_FROM_TOKEN",
            `User data updated: ${JSON.stringify(updateData)}`
          );
        }

        // Обновляем время последнего входа
        user.lastLoginAt = new Date();
        await user.save({ validateBeforeSave: false });
      }

      return user;
    } catch (error) {
      logError(error, "AuthService.getUserFromToken");
      throw error;
    }
  }

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

  // Генерация JWT токена для внутреннего использования (если нужно)
  generateInternalToken(user) {
    try {
      const payload = {
        userId: user._id,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
      };

      const token = jwt.sign(payload, config.JWT_SECRET, {
        expiresIn: config.JWT_EXPIRES_IN,
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

  // Обновление профиля пользователя
  async updateUserProfile(userId, updateData) {
    try {
      const user = await User.findById(userId);

      if (!user) {
        throw new Error("User not found");
      }

      // Разрешенные поля для обновления обычными пользователями
      const allowedFields = ["bio", "avatar"];
      const filteredData = {};

      allowedFields.forEach((field) => {
        if (updateData[field] !== undefined) {
          filteredData[field] = updateData[field];
        }
      });

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
        role: user.role,
        isVerified: user.isVerified,
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
