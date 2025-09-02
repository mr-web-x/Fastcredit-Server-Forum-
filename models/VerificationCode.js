// models/VerificationCode.js
import mongoose from "mongoose";

const verificationCodeSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      length: 6,
      match: /^[0-9]{6}$/,
    },
    type: {
      type: String,
      required: true,
      enum: ["email_verification", "password_reset"],
      index: true,
    },
    isUsed: {
      type: Boolean,
      default: false,
      index: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    requestIP: {
      type: String,
      default: null,
    },
    isValid: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true, // Добавляет createdAt и updatedAt
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ==================== ИНДЕКСЫ ДЛЯ ПРОИЗВОДИТЕЛЬНОСТИ ====================
verificationCodeSchema.index({ email: 1, type: 1, isUsed: 1 });
verificationCodeSchema.index({ email: 1, type: 1, expiresAt: 1 });
verificationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Автоочистка MongoDB
verificationCodeSchema.index({ code: 1, type: 1, isUsed: 1 });

// ==================== ВИРТУАЛЬНЫЕ ПОЛЯ ====================
verificationCodeSchema.virtual("isExpired").get(function () {
  return new Date() > this.expiresAt;
});

verificationCodeSchema.virtual("timeUntilExpiry").get(function () {
  if (this.isExpired) return 0;
  return Math.max(0, this.expiresAt.getTime() - Date.now());
});

verificationCodeSchema.virtual("remainingAttempts").get(function () {
  return Math.max(0, 5 - this.attempts);
});

// ==================== МЕТОДЫ ЭКЗЕМПЛЯРА ====================
verificationCodeSchema.methods.markAsUsed = async function () {
  this.isUsed = true;
  this.usedAt = new Date();
  return await this.save();
};

verificationCodeSchema.methods.incrementAttempts = async function () {
  this.attempts += 1;
  return await this.save();
};

verificationCodeSchema.methods.isValidForUse = function () {
  return (
    this.isValid &&
    this.code &&
    this.email &&
    !this.isUsed &&
    !this.isExpired &&
    this.attempts < 5
  );
};

verificationCodeSchema.methods.invalidate = async function () {
  this.isValid = false;
  return await this.save();
};

// ==================== СТАТИЧЕСКИЕ МЕТОДЫ ====================

// Генерация 6-значного кода
verificationCodeSchema.statics.generateCode = function () {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Создание нового кода верификации
verificationCodeSchema.statics.createVerificationCode = async function (
  email,
  type,
  expiryMinutes = 10,
  requestIP = null
) {
  try {
    // Удаляем все старые неиспользованные коды для этого email и типа
    await this.deleteMany({
      email: email.toLowerCase(),
      type,
      isUsed: false,
    });

    // Создаем новый код
    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    const verificationCode = await this.create({
      email: email.toLowerCase(),
      code,
      type,
      expiresAt,
      requestIP,
      isUsed: false,
      attempts: 0,
      isValid: true,
    });

    return verificationCode;
  } catch (error) {
    throw new Error(`Ошибка создания кода: ${error.message}`);
  }
};

// Проверка кода
verificationCodeSchema.statics.verifyCode = async function (email, code, type) {
  try {
    // Ищем код
    const verificationCode = await this.findOne({
      email: email.toLowerCase(),
      code: code.toString(),
      type,
      isUsed: false,
    });

    if (!verificationCode) {
      return {
        success: false,
        error: "INVALID_CODE",
        message: "Неверный код подтверждения",
      };
    }

    // Проверяем истечение
    if (verificationCode.isExpired) {
      return {
        success: false,
        error: "CODE_EXPIRED",
        message: "Код подтверждения истек",
      };
    }

    // Проверяем количество попыток
    if (verificationCode.attempts >= 5) {
      return {
        success: false,
        error: "TOO_MANY_ATTEMPTS",
        message: "Превышено количество попыток ввода кода",
      };
    }

    // Инкрементируем попытки
    await verificationCode.incrementAttempts();

    // Проверяем валидность кода
    if (!verificationCode.isValidForUse()) {
      return {
        success: false,
        error: "INVALID_CODE_STATE",
        message: "Код находится в недействительном состоянии",
      };
    }

    // Помечаем как использованный
    await verificationCode.markAsUsed();

    return {
      success: true,
      verificationCode,
      message: "Код успешно подтвержден",
    };
  } catch (error) {
    return {
      success: false,
      error: "VERIFICATION_ERROR",
      message: `Ошибка проверки кода: ${error.message}`,
    };
  }
};

// Поиск активного кода
verificationCodeSchema.statics.findActiveCode = function (email, type) {
  return this.findOne({
    email: email.toLowerCase(),
    type,
    isUsed: false,
    expiresAt: { $gt: new Date() },
    attempts: { $lt: 5 },
    isValid: true,
  });
};

// История кодов пользователя
verificationCodeSchema.statics.getCodeHistory = function (email, limit = 10) {
  return this.find({ email: email.toLowerCase() })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select("type code isUsed usedAt attempts createdAt expiresAt requestIP");
};

// Очистка истекших кодов
verificationCodeSchema.statics.cleanupExpiredCodes = async function () {
  try {
    const result = await this.deleteMany({
      expiresAt: { $lt: new Date() },
    });

    return {
      success: true,
      deletedCount: result.deletedCount,
      message: `Удалено ${result.deletedCount} истекших кодов`,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: "Ошибка при очистке истекших кодов",
    };
  }
};

// Статистика кодов
verificationCodeSchema.statics.getStatistics = async function () {
  try {
    const stats = await this.aggregate([
      {
        $group: {
          _id: "$type",
          total: { $sum: 1 },
          used: { $sum: { $cond: ["$isUsed", 1, 0] } },
          expired: {
            $sum: {
              $cond: [{ $lt: ["$expiresAt", new Date()] }, 1, 0],
            },
          },
          active: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$isUsed", false] },
                    { $gt: ["$expiresAt", new Date()] },
                    { $lt: ["$attempts", 5] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          averageAttempts: { $avg: "$attempts" },
        },
      },
    ]);

    const totalStats = await this.countDocuments();

    return {
      total: totalStats,
      byType: stats.reduce((acc, stat) => {
        acc[stat._id] = {
          total: stat.total,
          used: stat.used,
          expired: stat.expired,
          active: stat.active,
          averageAttempts: Math.round(stat.averageAttempts * 100) / 100,
        };
        return acc;
      }, {}),
    };
  } catch (error) {
    throw new Error(`Ошибка получения статистики: ${error.message}`);
  }
};

// Pre-save middleware
verificationCodeSchema.pre("save", function (next) {
  // Приводим email к нижнему регистру
  if (this.isModified("email")) {
    this.email = this.email.toLowerCase();
  }

  next();
});

const VerificationCode = mongoose.model(
  "VerificationCode",
  verificationCodeSchema
);
export default VerificationCode;
