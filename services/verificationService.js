// services/verificationService.js
import VerificationCode from "../models/VerificationCode.js";
import User from "../models/User.js";
import {
  logUserAction,
  logError,
  logSecurityEvent,
} from "../middlewares/logger.js";
import emailService from "./emailService.js";
import cryptoService from "./cryptoService.js";

class VerificationService {
  // Генерация и отправка кода подтверждения email
  async sendEmailVerificationCode(email, requestIP = null) {
    try {
      const hashedEmail = await cryptoService.hashData(email);
      // Проверяем существование пользователя
      const user = await User.findOne({
        email: hashedEmail,
        provider: "local",
      });

      if (!user) {
        throw new Error("POUŽÍVATEĽ_NENÁJDENÝ");
      }

      // Если email уже подтвержден
      if (user.isEmailVerified) {
        return {
          success: false,
          error: "EMAIL_UŽ_OVERENÝ",
          message: "Email už bol overený",
        };
      }

      // Проверяем, есть ли активный код (не истекший)
      const existingCode = await VerificationCode.findActiveCode(
        hashedEmail,
        "email_verification"
      );

      if (existingCode) {
        const timeLeft = Math.ceil(existingCode.timeUntilExpiry / 1000 / 60);
        return {
          success: false,
          error: "KÓD_UŽ_ODOSLANÝ",
          message: `Kód už bol odoslaný. Opätovné odoslanie je možné o ${timeLeft} min.`,
          timeUntilExpiry: existingCode.timeUntilExpiry,
        };
      }

      // Создаем новый код (10 минут действия)
      const verificationCode = await VerificationCode.createVerificationCode(
        hashedEmail,
        "email_verification",
        10, // 10 минут
        requestIP
      );

      console.log("verificationCode", verificationCode);

      try {
        await emailService.sendEmail(email, "code", "FastCredit", {
          code: verificationCode.code,
        });
      } catch (error) {
        console.log("EMAIL error", verificationCode.code);
      }

      logUserAction(
        user._id,
        "EMAIL_VERIFICATION_CODE_SENT",
        `Verification code sent to ${email}`
      );

      return {
        success: true,
        message: "Overovací kód bol odoslaný na email",
        expiresAt: verificationCode.expiresAt,
        ...(process.env.NODE_ENV === "development" && {
          devCode: verificationCode.code,
        }),
      };
    } catch (error) {
      logError(error, "VerificationService.sendEmailVerificationCode");

      if (error.message === "POUŽÍVATEĽ_NENÁJDENÝ") {
        throw new Error("Používateľ s týmto emailom nebol nájdený");
      }

      throw error;
    }
  }

  // Подтверждение email по коду (ИСПРАВЛЕНО - БЫЛ ОБРЕЗАН!)
  async verifyEmailCode(email, code, requestIP = null) {
    try {
      const hashedEmail = await cryptoService.hashData(email);

      // Ищем пользователя
      const user = await User.findOne({
        email: hashedEmail,
        provider: "local",
      });

      if (!user) {
        logSecurityEvent(
          "EMAIL_VERIFICATION_FAILED",
          `Verification attempt for non-existent user: ${email}`,
          null,
          requestIP
        );
        throw new Error("POUŽÍVATEĽ_NENÁJDENÝ");
      }

      // Если email уже подтвержден
      if (user.isEmailVerified) {
        return {
          success: true,
          message: "Email už bol overený",
          alreadyVerified: true,
        };
      }

      // Проверяем код
      const verificationResult = await VerificationCode.verifyCode(
        hashedEmail,
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

        verificationResult.message = "Neplatný alebo expirovaný kód";
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
        message: "Email bol úspešne overený",
        user: {
          id: user._id,
          email: user.email,
          isEmailVerified: true,
        },
      };
    } catch (error) {
      logError(error, "VerificationService.verifyEmailCode");

      if (error.message === "POUŽÍVATEĽ_NENÁJDENÝ") {
        throw new Error("Používateľ nebol nájdený");
      }

      throw error;
    }
  }

  // Генерация и отправка кода для сброса пароля (ДОПИСАНО)
  async sendPasswordResetCode(email, requestIP = null) {
    try {
      const hashedEmail = await cryptoService.hashData(email);
      // Проверяем существование пользователя
      const user = await User.findOne({
        email: hashedEmail,
        provider: "local",
      });

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
            "Ak používateľ s týmto emailom existuje, kód bol odoslaný na email",
        };
      }

      // Проверяем, есть ли активный код
      const existingCode = await VerificationCode.findActiveCode(
        hashedEmail,
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
          error: "KÓD_UŽ_ODOSLANÝ",
          message: `Kód už bol odoslaný. Opätovné odoslanie je možné o ${timeLeft} min.`,
          timeUntilExpiry: existingCode.timeUntilExpiry,
        };
      }

      // Создаем новый код (15 минут для сброса пароля)
      const verificationCode = await VerificationCode.createVerificationCode(
        hashedEmail,
        "password_reset",
        15, // 15 минут
        requestIP
      );

      try {
        await emailService.sendEmail(email, "code", "FastCredit", {
          code: verificationCode.code,
        });

        logUserAction(
          null,
          "PASSWORD_RESET_EMAIL_SENT",
          `Password reset email sent to ${email}`
        );
      } catch (emailError) {
        console.error("Failed to send password reset email:", emailError);
        console.log("Verification code:", verificationCode.code);
      }

      logUserAction(
        user._id,
        "PASSWORD_RESET_CODE_SENT",
        `Password reset code sent to ${email}`
      );

      return {
        success: true,
        message: "Kód na obnovenie hesla bol odoslaný na email",
        expiresAt: verificationCode.expiresAt,
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
      const hashedEmail = await cryptoService.hashData(email);

      // Ищем пользователя
      const user = await User.findOne({
        email: hashedEmail,
        provider: "local",
      });

      if (!user) {
        logSecurityEvent(
          "PASSWORD_RESET_VERIFICATION_FAILED",
          `Reset code verification for non-existent user: ${email}`,
          null,
          requestIP
        );
        throw new Error("POUŽÍVATEĽ_NENÁJDENÝ");
      }

      // Проверяем код
      const verificationResult = await VerificationCode.verifyCode(
        hashedEmail,
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

        verificationResult.message = "Neplatný alebo expirovaný kód";
        return verificationResult;
      }

      logUserAction(
        user._id,
        "PASSWORD_RESET_CODE_VERIFIED",
        `Password reset code verified for ${email}`
      );

      return {
        success: true,
        message: "Kód bol overený. Teraz môžete nastaviť nové heslo",
        resetToken: verificationResult.verificationCode._id.toString(),
        user: {
          id: user._id,
          email: user.email,
        },
      };
    } catch (error) {
      logError(error, "VerificationService.verifyPasswordResetCode");

      if (error.message === "POUŽÍVATEĽ_NENÁJDENÝ") {
        throw new Error("Používateľ nebol nájdený");
      }

      throw error;
    }
  }

  // Сброс пароля по коду (вместо токена)
  async resetPasswordWithCode(email, code, newPassword, requestIP = null) {
    try {
      const hashedEmail = await cryptoService.hashData(email);

      // Ищем пользователя
      const user = await User.findOne({
        email: hashedEmail,
        provider: "local",
      });

      if (!user) {
        throw new Error("POUŽÍVATEĽ_NENÁJDENÝ");
      }

      // Проверяем код (он должен быть использован, но еще действительный)
      const verificationCode = await VerificationCode.findOne({
        email: hashedEmail,
        code: code.toString(),
        type: "password_reset",
        isUsed: true,
        usedAt: { $gt: new Date(Date.now() - 5 * 60 * 1000) },
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
          error: "NEPLATNÝ_ALEBO_EXPIROVANÝ_KÓD",
          message: "Neplatný alebo expirovaný kód. Požiadajte o nový kód.",
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
        email: hashedEmail,
        type: "password_reset",
      });

      logUserAction(
        user._id,
        "PASSWORD_RESET_COMPLETED",
        `Password successfully reset for ${email}`
      );

      return {
        success: true,
        message: "Heslo bolo úspešne zmenené",
        user: {
          id: user._id,
          email: user.email,
        },
      };
    } catch (error) {
      logError(error, "VerificationService.resetPasswordWithCode");

      if (error.message === "POUŽÍVATEĽ_NENÁJDENÝ") {
        throw new Error("Používateľ nebol nájdený");
      }

      throw error;
    }
  }

  // Получение информации об активном коде
  async getActiveCodeInfo(email, type) {
    try {
      const hashedEmail = await cryptoService.hashData(email);

      const activeCode = await VerificationCode.findActiveCode(
        hashedEmail,
        type
      );

      if (!activeCode) {
        return {
          hasActiveCode: false,
          message: "Aktívny kód nebol nájdený",
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
      const hashedEmail = await cryptoService.hashData(email);

      const result = await VerificationCode.deleteMany({
        email: hashedEmail,
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
            ? "Aktívny kód bol zrušený"
            : "Aktívny kód nebol nájdený",
      };
    } catch (error) {
      logError(error, "VerificationService.cancelActiveCode");
      throw error;
    }
  }

  // Получение истории кодов для пользователя (для админов)
  async getCodeHistory(email, limit = 10) {
    try {
      const hashedEmail = await cryptoService.hashData(email);

      const history = await VerificationCode.getCodeHistory(hashedEmail, limit);

      return {
        email,
        history: history.map((code) => ({
          type: code.type,
          code: code.code.replace(/\d/g, "*"),
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
