// models/VerificationCode.js
import mongoose from "mongoose";

const verificationCodeSchema = new mongoose.Schema(
  {
    // Email пользователя
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    // 6-значный код
    code: {
      type: String,
      required: true,
      length: 6,
      match: /^[0-9]{6}$/, // только цифры
    },

    // Тип кода
    type: {
      type: String,
      enum: ["email_verification", "password_reset"],
      required: true,
      index: true,
    },

    // Время истечения
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 }, // MongoDB автоматически удалит документ после истечения
    },

    // Использован ли код
    isUsed: {
      type: Boolean,
      default: false,
      index: true,
    },

    // Время использования
    usedAt: {
      type: Date,
      default: null,
    },

    // IP адрес запроса
    requestIP: {
      type: String,
      default: null,
    },

    // Количество попыток использования
    attempts: {
      type: Number,
      default: 0,
      max: 5, // максимум 5 попыток
    },
  },
  {
    timestamps: true,
  }
);

// Составные индексы
verificationCodeSchema.index({ email: 1, type: 1 });
verificationCodeSchema.index({ code: 1, isUsed: 1 });
verificationCodeSchema.index({ createdAt: -1 });

// Виртуальные поля
verificationCodeSchema.virtual("isExpired").get(function () {
  return new Date() > this.expiresAt;
});

verificationCodeSchema.virtual("isValid").get(function () {
  return !this.isUsed && !this.isExpired && this.attempts < 5;
});

verificationCodeSchema.virtual("timeUntilExpiry").get(function () {
  if (this.isExpired) return 0;
  return Math.max(0, this.expiresAt.getTime() - Date.now());
});

// Методы экземпляра
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
  return this.isValid && this.code && this.email;
};

// Статические методы
verificationCodeSchema.statics.generateCode = function () {
  // Генерируем 6-значный код
  return Math.floor(100000 + Math.random() * 900000).toString();
};

verificationCodeSchema.statics.createVerificationCode = async function (
  email,
  type,
  expiryMinutes = 10,
  requestIP = null
) {
  try {
    // Удаляем все старые неиспользованные коды для этого email и типа
    await this.deleteMany({
      email,
      type,
      isUsed: false,
    });

    // Создаем новый код
    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    const verificationCode = await this.create({
      email,
      code,
      type,
      expiresAt,
      requestIP,
      isUsed: false,
      attempts: 0,
    });

    return verificationCode;
  } catch (error) {
    throw error;
  }
};

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
    throw error;
  }
};

verificationCodeSchema.statics.findActiveCode = function (email, type) {
  return this.findOne({
    email: email.toLowerCase(),
    type,
    isUsed: false,
    expiresAt: { $gt: new Date() },
    attempts: { $lt: 5 },
  });
};

verificationCodeSchema.statics.getCodeHistory = function (email, limit = 10) {
  return this.find({ email: email.toLowerCase() })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select("type code isUsed usedAt attempts createdAt expiresAt");
};

verificationCodeSchema.statics.cleanupExpiredCodes = async function () {
  try {
    const result = await this.deleteMany({
      expiresAt: { $lt: new Date() },
    });

    return {
      deletedCount: result.deletedCount,
      message: `Удалено ${result.deletedCount} истекших кодов`,
    };
  } catch (error) {
    throw error;
  }
};

verificationCodeSchema.statics.getStatistics = async function () {
  try {
    const [totalCodes, usedCodes, expiredCodes, activeCodesTypes] =
      await Promise.all([
        this.countDocuments(),
        this.countDocuments({ isUsed: true }),
        this.countDocuments({ expiresAt: { $lt: new Date() } }),
        this.aggregate([
          {
            $match: {
              isUsed: false,
              expiresAt: { $gt: new Date() },
            },
          },
          {
            $group: {
              _id: "$type",
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

    return {
      total: totalCodes,
      used: usedCodes,
      expired: expiredCodes,
      active: totalCodes - usedCodes - expiredCodes,
      byType: activeCodesTypes.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
    };
  } catch (error) {
    throw error;
  }
};

// Pre-save middleware
verificationCodeSchema.pre("save", function (next) {
  // Убеждаемся что email в нижнем регистре
  if (this.isModified("email")) {
    this.email = this.email.toLowerCase();
  }

  // Убеждаемся что code это строка из 6 цифр
  if (this.isModified("code")) {
    this.code = this.code.toString().padStart(6, "0");
  }

  next();
});

// Post-save middleware для логирования
verificationCodeSchema.post("save", function (doc) {
  if (doc.isNew) {
    console.log(`Verification code created: ${doc.type} for ${doc.email}`);
  }
});

const VerificationCode = mongoose.model(
  "VerificationCode",
  verificationCodeSchema
);

export default VerificationCode;
