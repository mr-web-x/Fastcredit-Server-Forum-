// models/User.js
import mongoose from "mongoose";
import { USER_ROLES } from "../utils/constants.js";
import { hashPassword, generateSecureToken } from "../utils/security.js";

const userSchema = new mongoose.Schema(
  {
    // OAuth провайдер (для различения способа регистрации)
    provider: {
      type: String,
      enum: ["local", "google"],
      default: "local", // По умолчанию локальная регистрация
      index: true,
    },

    // Стабильный идентификатор Google (sub). Только для Google OAuth
    googleId: {
      type: String,
      sparse: true, // позволяет иметь много пользователей без googleId
      index: true,
      default: null,
    },

    // Основные поля
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    // Username для локальной авторизации (необязательный)
    username: {
      type: String,
      unique: true,
      sparse: true, // позволяет null значения без нарушения уникальности
      trim: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-zA-Z0-9_]+$/, // только буквы, цифры и подчеркивание
      index: true,
      default: null,
    },

    // Пароль для локальной авторизации
    password: {
      type: String,
      required: function () {
        return this.provider === "local";
      },
      minlength: 6,
      select: false, // По умолчанию не включать в выборки
    },

    // Имя и фамилия
    firstName: {
      type: String,
      trim: true,
      maxlength: 50,
      default: null,
    },

    lastName: {
      type: String,
      trim: true,
      maxlength: 50,
      default: null,
    },

    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.USER,
      index: true,
    },

    // Email verification для локальной регистрации
    isEmailVerified: {
      type: Boolean,
      default: function () {
        // Google пользователи автоматически верифицированы
        return this.provider === "google";
      },
      index: true,
    },

    // Старое поле для совместимости (deprecated, используем isEmailVerified)
    isVerified: {
      type: Boolean,
      default: function () {
        return this.isEmailVerified;
      },
    },

    avatar: {
      type: String,
      default: null,
    },

    bio: {
      type: String,
      maxlength: 500,
      default: null,
    },

    rating: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalAnswers: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalQuestions: {
      type: Number,
      default: 0,
      min: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    isBanned: {
      type: Boolean,
      default: false,
      index: true,
    },

    bannedUntil: {
      type: Date,
      default: null,
    },

    bannedReason: {
      type: String,
      default: null,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    roleChangedAt: {
      type: Date,
      default: null,
    },

    roleChangedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Поля для восстановления пароля
    passwordResetToken: {
      type: String,
      default: null,
      select: false,
    },

    passwordResetExpires: {
      type: Date,
      default: null,
      select: false,
    },

    // ========== ПОЛЯ ДЛЯ ЗАЩИТЫ ОТ БРУТФОРСА ==========
    // Количество неудачных попыток входа
    loginAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Время блокировки аккаунта (ДОБАВЛЕНО - ОТСУТСТВОВАЛО!)
    lockUntil: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ==================== ИНДЕКСЫ ДЛЯ ПРОИЗВОДИТЕЛЬНОСТИ ====================
userSchema.index({ email: 1, provider: 1 });
userSchema.index({ username: 1, provider: 1 });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ isEmailVerified: 1, provider: 1 });
userSchema.index({ lockUntil: 1 }, { sparse: true });
userSchema.index({ bannedUntil: 1 }, { sparse: true });

// ==================== ВИРТУАЛЬНЫЕ ПОЛЯ ====================
userSchema.virtual("fullName").get(function () {
  if (this.firstName && this.lastName) {
    return `${this.firstName} ${this.lastName}`;
  }
  if (this.firstName) return this.firstName;
  if (this.lastName) return this.lastName;
  return this.email;
});

userSchema.virtual("displayName").get(function () {
  return this.username || this.fullName || this.email;
});

// ========== ВИРТУАЛЬНЫЕ ПОЛЯ ДЛЯ БЛОКИРОВКИ ==========
userSchema.virtual("isTemporarilyBanned").get(function () {
  return this.bannedUntil && this.bannedUntil > Date.now();
});

// ==================== МЕТОДЫ ЭКЗЕМПЛЯРА ====================

// ========== МЕТОДЫ ДЛЯ БЛОКИРОВКИ (ДОБАВЛЕНО - ОТСУТСТВОВАЛО!) ==========
userSchema.methods.isBannedCurrently = function () {
  if (!this.isBanned) return false;

  // Постоянный бан
  if (!this.bannedUntil) return true;

  // Временный бан
  if (this.bannedUntil > new Date()) return true;

  // Бан истек - сбрасываем
  if (this.bannedUntil <= new Date()) {
    this.isBanned = false;
    this.bannedUntil = null;
    this.bannedReason = null;
    return false;
  }

  return false;
};

userSchema.methods.isAccountLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now();
};

// Увеличение попыток входа и блокировка при необходимости
userSchema.methods.incLoginAttempts = async function () {
  const updates = {
    $inc: { loginAttempts: 1 },
  };

  // Если это 5-я попытка, блокируем на 30 минут
  if (this.loginAttempts + 1 >= 5 && !this.isAccountLocked) {
    updates.$set = {
      lockUntil: Date.now() + 30 * 60 * 1000, // 30 минут
    };
  }

  return await this.updateOne(updates);
};

// Сброс попыток входа
userSchema.methods.resetLoginAttempts = async function () {
  return await this.updateOne({
    $unset: {
      loginAttempts: 1,
      lockUntil: 1,
    },
  });
};

// Генерация токена сброса пароля с помощью security.js
userSchema.methods.generatePasswordResetToken = function () {
  const resetToken = generateSecureToken(16); // 32 символа hex

  this.passwordResetToken = resetToken;
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 минут

  return resetToken;
};

// Проверка роли пользователя
userSchema.methods.hasRole = function (role) {
  return this.role === role;
};

userSchema.methods.isAdmin = function () {
  return this.role === USER_ROLES.ADMIN;
};

userSchema.methods.isExpert = function () {
  return this.role === USER_ROLES.EXPERT || this.role === USER_ROLES.ADMIN;
};

userSchema.methods.isUser = function () {
  return this.role === USER_ROLES.USER;
};

// Проверка доступности функций (только для подтвержденных пользователей)
userSchema.methods.canAccessFeatures = function () {
  return this.isEmailVerified && this.isActive && !this.isBannedCurrently();
};

// Обновление статистики пользователя
userSchema.methods.incrementQuestionCount = async function () {
  this.totalQuestions += 1;
  return await this.save();
};

userSchema.methods.incrementAnswerCount = async function () {
  this.totalAnswers += 1;
  return await this.save();
};

userSchema.methods.updateRating = async function (change) {
  this.rating = Math.max(0, this.rating + change);
  return await this.save();
};

// ==================== СТАТИЧЕСКИЕ МЕТОДЫ ====================
userSchema.statics.findActiveExperts = function () {
  return this.find({
    role: { $in: [USER_ROLES.EXPERT, USER_ROLES.ADMIN] },
    isActive: true,
    isBanned: false,
  }).sort({ rating: -1, totalAnswers: -1 });
};

userSchema.statics.findByRole = function (role) {
  return this.find({
    role,
    isActive: true,
  }).sort({ createdAt: -1 });
};

userSchema.statics.findByEmailOrUsername = function (
  login,
  includePassword = false
) {
  const query = this.findOne({
    $or: [{ email: login.toLowerCase() }, { username: login }],
    provider: "local",
  });

  if (includePassword) {
    query.select("+password");
  }

  return query;
};

userSchema.statics.getStatistics = async function () {
  const stats = await this.aggregate([
    {
      $group: {
        _id: "$role",
        count: { $sum: 1 },
        active: { $sum: { $cond: ["$isActive", 1, 0] } },
        banned: { $sum: { $cond: ["$isBanned", 1, 0] } },
        verified: { $sum: { $cond: ["$isEmailVerified", 1, 0] } },
      },
    },
  ]);

  return stats.reduce((acc, stat) => {
    acc[stat._id] = {
      total: stat.count,
      active: stat.active,
      banned: stat.banned,
      verified: stat.verified,
    };
    return acc;
  }, {});
};

// ==================== MIDDLEWARE ====================

// Pre-save middleware - только хеширование пароля
userSchema.pre("save", async function (next) {
  // Хешируем пароль только если он изменился, используя security.js
  if (this.isModified("password")) {
    this.password = await hashPassword(this.password);
  }

  // Обновляем roleChangedAt при изменении роли
  if (this.isModified("role")) {
    this.roleChangedAt = new Date();
  }

  // Сбрасываем поля бана если пользователь разбанен
  if (this.isModified("isBanned") && !this.isBanned) {
    this.bannedUntil = null;
    this.bannedReason = null;
  }

  // Синхронизируем старое поле isVerified с новым isEmailVerified
  if (this.isModified("isEmailVerified")) {
    this.isVerified = this.isEmailVerified;
  }

  next();
});

// Post-save middleware
userSchema.post("save", function (doc) {
  if (doc.isModified("role")) {
    console.log(`User role changed: ${doc.email} -> ${doc.role}`);
  }
});

const User = mongoose.model("User", userSchema);
export default User;
