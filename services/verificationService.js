// services/verificationService.js
import VerificationCode from "../models/VerificationCode.js";
import User from "../models/User.js";
import {
  logUserAction,
  logError,
  logSecurityEvent,
} from "../middlewares/logger.js";

class VerificationService {
  // Генерация и отправка кода подтверждения email
  async sendEmailVerificationCode(email, requestIP = null) {
    try {
      // Проверяем существование пользователя
      const user = await User.findOne({ email, provider: "local" });

      if (!user) {
        throw new Error("USER_NOT_FOUND");
      }

      // Если email уже подтвержден
      if (user.isEmailVerified) {
        return {
          success: false,
          error: "EMAIL_ALREADY_VERIFIED",
          message: "Email уже подтвержден",
        };
      }

      // Проверяем, есть ли активный код (не истекший)
      const existingCode = await VerificationCode.findActiveCode(
        email,
        "email_verification"
      );

      if (existingCode) {
        const timeLeft = Math.ceil(existingCode.timeUntilExpiry / 1000 / 60);
        return {
          success: false,
          error: "CODE_ALREADY_SENT",
          message: `Код уже отправлен. Повторная отправка возможна через ${timeLeft} мин.`,
          timeUntilExpiry: existingCode.timeUntilExpiry,
        };
      }

      // Создаем новый код (10 минут действия)
      const verificationCode = await VerificationCode.createVerificationCode(
        email,
        "email_verification",
        10, // 10 минут
        requestIP
      );

      // TODO: Здесь отправляем email
      // await emailService.sendMessage(email, {
      //   subject: 'Подтверждение email',
      //   template: 'email_verification',
      //   data: { code: verificationCode.code }
      // });

      logUserAction(
        user._id,
        "EMAIL_VERIFICATION_CODE_SENT",
        `Verification code sent to ${email}`
      );

      return {
        success: true,
        message: "Код подтверждения отправлен на email",
        expiresAt: verificationCode.expiresAt,
        // В development можно возвращать код для тестирования
        ...(process.env.NODE_ENV === "development" && {
          devCode: verificationCode.code,
        }),
      };
    } catch (error) {
      logError(error, "VerificationService.sendEmailVerificationCode");

      if (error.message === "USER_NOT_FOUND") {
        throw new Error("Пользователь с таким email не найден");
      }

      throw error;
    }
  }

  // Подтверждение email по коду
  async verifyEmailCode(email, code, requestIP = null) {
    try {
      // Ищем пользователя
      const user = await User.findOne({ email, provider: "local" });

      if (!user) {
        logSecurityEvent(
          "EMAIL_VERIFICATION_FAILED",
          `Verification attempt for non-existent user: ${email}`,
          null,
          requestIP
        );
        throw new Error("USER_NOT_FOUND");
      }

      // Если email уже подтвержден
      if (user.isEmailVerified) {
        return {
          success: true,
          message: "Email уже подтвержден",
          alreadyVerified: true,
        };
      }

      // Проверяем код
      const verificationResult = await VerificationCode.verifyCode(
        email,
        code,
        "email_verification"
      );

      if (!verificationResult.success) {
        logSecurityEvent(
          "EMAIL_VERIFICATION_FAILED",
          `Failed verification attempt: ${verificationResult.error} for ${email}`,
          user._id,
          requestIP
        );

        return verificationResult;
      }

      // Подтверждаем email пользователя
      user.isEmailVerified = true;
      user.isVerified = true;
      await user.save();

      logUserAction(
        user._id,
        "EMAIL_VERIFIED_SUCCESS",
        `Email successfully verified for ${email}`
      );

      return {
        success: true,
        message: "Email успешно подтвержден",
        user: {
          id: user._id,
          email: user.email,
          isEmailVerified: true,
        },
      };
    } catch (error) {
      logError(error, "VerificationService.verifyEmailCode");

      if (error.message === "USER_NOT_FOUND") {
        throw new Error("Пользователь не найден");
      }

      throw error;
    }
  }

  // Генерация и отправка кода для сброса пароля
  async sendPasswordResetCode(email, requestIP = null) {
    try {
      // Проверяем существование пользователя
      const user = await User.findOne({ email, provider: "local" });

      // Не раскрываем существование пользователя по соображениям безопасности
      if (!user) {
        logSecurityEvent(
          "PASSWORD_RESET_ATTEMPT_UNKNOWN_EMAIL",
          `Password reset attempt for unknown email: ${email}`,
          null,
          requestIP
        );

        return {
          success: true,
          message:
            "Если пользователь с таким email существует, код отправлен на почту",
        };
      }

      // Проверяем, есть ли активный код
      const existingCode = await VerificationCode.findActiveCode(
        email,
        "password_reset"
      );

      if (existingCode) {
        const timeLeft = Math.ceil(existingCode.timeUntilExpiry / 1000 / 60);

        logSecurityEvent(
          "PASSWORD_RESET_CODE_ALREADY_ACTIVE",
          `Attempt to request reset code while active code exists for ${email}`,
          user._id,
          requestIP
        );

        return {
          success: false,
          error: "CODE_ALREADY_SENT",
          message: `Код уже отправлен. Повторная отправка возможна через ${timeLeft} мин.`,
          timeUntilExpiry: existingCode.timeUntilExpiry,
        };
      }

      // Создаем новый код (15 минут для сброса пароля)
      const verificationCode = await VerificationCode.createVerificationCode(
        email,
        "password_reset",
        15, // 15 минут
        requestIP
      );

      // TODO: Здесь отправляем email
      // await emailService.sendMessage(email, {
      //   subject: 'Сброс пароля',
      //   template: 'password_reset',
      //   data: { code: verificationCode.code }
      // });

      logUserAction(
        user._id,
        "PASSWORD_RESET_CODE_SENT",
        `Password reset code sent to ${email}`
      );

      return {
        success: true,
        message: "Код для сброса пароля отправлен на email",
        expiresAt: verificationCode.expiresAt,
        // В development можно возвращать код для тестирования
        ...(process.env.NODE_ENV === "development" && {
          devCode: verificationCode.code,
        }),
      };
    } catch (error) {
      logError(error, "VerificationService.sendPasswordResetCode");
      throw error;
    }
  }

  // Проверка кода сброса пароля
  async verifyPasswordResetCode(email, code, requestIP = null) {
    try {
      // Ищем пользователя
      const user = await User.findOne({ email, provider: "local" });

      if (!user) {
        logSecurityEvent(
          "PASSWORD_RESET_VERIFICATION_FAILED",
          `Reset code verification for non-existent user: ${email}`,
          null,
          requestIP
        );
        throw new Error("USER_NOT_FOUND");
      }

      // Проверяем код
      const verificationResult = await VerificationCode.verifyCode(
        email,
        code,
        "password_reset"
      );

      if (!verificationResult.success) {
        logSecurityEvent(
          "PASSWORD_RESET_CODE_INVALID",
          `Invalid reset code attempt: ${verificationResult.error} for ${email}`,
          user._id,
          requestIP
        );

        return verificationResult;
      }

      logUserAction(
        user._id,
        "PASSWORD_RESET_CODE_VERIFIED",
        `Password reset code verified for ${email}`
      );

      return {
        success: true,
        message: "Код подтвержден. Теперь можно установить новый пароль",
        resetToken: verificationResult.verificationCode._id.toString(), // Используем ID кода как токен
        user: {
          id: user._id,
          email: user.email,
        },
      };
    } catch (error) {
      logError(error, "VerificationService.verifyPasswordResetCode");

      if (error.message === "USER_NOT_FOUND") {
        throw new Error("Пользователь не найден");
      }

      throw error;
    }
  }

  // Сброс пароля по коду (вместо токена)
  async resetPasswordWithCode(email, code, newPassword, requestIP = null) {
    try {
      // Ищем пользователя
      const user = await User.findOne({ email, provider: "local" });

      if (!user) {
        throw new Error("USER_NOT_FOUND");
      }

      // Проверяем код (он должен быть использован, но еще действительный)
      const verificationCode = await VerificationCode.findOne({
        email: email.toLowerCase(),
        code: code.toString(),
        type: "password_reset",
        isUsed: true, // Код должен быть уже проверен в verifyPasswordResetCode
        usedAt: { $gt: new Date(Date.now() - 5 * 60 * 1000) }, // Использован не более 5 минут назад
      });

      if (!verificationCode) {
        logSecurityEvent(
          "PASSWORD_RESET_INVALID_TOKEN",
          `Password reset with invalid/expired code for ${email}`,
          user._id,
          requestIP
        );

        return {
          success: false,
          error: "INVALID_OR_EXPIRED_CODE",
          message: "Недействительный или истекший код. Запросите новый код.",
        };
      }

      // Устанавливаем новый пароль (он автоматически захешируется в модели)
      user.password = newPassword;

      // Сбрасываем блокировку аккаунта если была
      user.loginAttempts = undefined;
      user.lockUntil = undefined;

      await user.save();

      // Удаляем все коды сброса пароля для этого email
      await VerificationCode.deleteMany({
        email: email.toLowerCase(),
        type: "password_reset",
      });

      logUserAction(
        user._id,
        "PASSWORD_RESET_COMPLETED",
        `Password successfully reset for ${email}`
      );

      return {
        success: true,
        message: "Пароль успешно изменен",
        user: {
          id: user._id,
          email: user.email,
        },
      };
    } catch (error) {
      logError(error, "VerificationService.resetPasswordWithCode");

      if (error.message === "USER_NOT_FOUND") {
        throw new Error("Пользователь не найден");
      }

      throw error;
    }
  }

  // Получение информации об активном коде
  async getActiveCodeInfo(email, type) {
    try {
      const activeCode = await VerificationCode.findActiveCode(email, type);

      if (!activeCode) {
        return {
          hasActiveCode: false,
          message: "Активный код не найден",
        };
      }

      return {
        hasActiveCode: true,
        expiresAt: activeCode.expiresAt,
        timeUntilExpiry: activeCode.timeUntilExpiry,
        attempts: activeCode.attempts,
        maxAttempts: 5,
        remainingAttempts: 5 - activeCode.attempts,
      };
    } catch (error) {
      logError(error, "VerificationService.getActiveCodeInfo");
      throw error;
    }
  }

  // Отмена активного кода (если нужно)
  async cancelActiveCode(email, type, requestIP = null) {
    try {
      const result = await VerificationCode.deleteMany({
        email: email.toLowerCase(),
        type,
        isUsed: false,
      });

      if (result.deletedCount > 0) {
        logUserAction(
          null,
          "VERIFICATION_CODE_CANCELLED",
          `Active ${type} code cancelled for ${email}`
        );
      }

      return {
        success: true,
        cancelled: result.deletedCount > 0,
        message:
          result.deletedCount > 0
            ? "Активный код отменен"
            : "Активный код не найден",
      };
    } catch (error) {
      logError(error, "VerificationService.cancelActiveCode");
      throw error;
    }
  }

  // Получение истории кодов для пользователя (для админов)
  async getCodeHistory(email, limit = 10) {
    try {
      const history = await VerificationCode.getCodeHistory(email, limit);

      return {
        email,
        history: history.map((code) => ({
          type: code.type,
          code: code.code.replace(/\d/g, "*"), // Маскируем код для безопасности
          isUsed: code.isUsed,
          usedAt: code.usedAt,
          attempts: code.attempts,
          createdAt: code.createdAt,
          expiresAt: code.expiresAt,
          isExpired: code.isExpired,
        })),
      };
    } catch (error) {
      logError(error, "VerificationService.getCodeHistory");
      throw error;
    }
  }

  // Статистика по кодам (для админов)
  async getVerificationStatistics() {
    try {
      const stats = await VerificationCode.getStatistics();
      return stats;
    } catch (error) {
      logError(error, "VerificationService.getVerificationStatistics");
      throw error;
    }
  }

  // Очистка истекших кодов (для планировщика задач)
  async cleanupExpiredCodes() {
    try {
      const result = await VerificationCode.cleanupExpiredCodes();

      if (result.deletedCount > 0) {
        logUserAction(
          null,
          "VERIFICATION_CODES_CLEANUP",
          `Cleaned up ${result.deletedCount} expired verification codes`
        );
      }

      return result;
    } catch (error) {
      logError(error, "VerificationService.cleanupExpiredCodes");
      throw error;
    }
  }
}

export default new VerificationService();
