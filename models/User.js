// models/User.js
import mongoose from "mongoose";
import { USER_ROLES } from "../utils/constants.js";
import { hashPassword, generateSecureToken } from "../utils/security.js";

const userSchema = new mongoose.Schema(
  {
    // OAuth провайдер
    provider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
      index: true,
    },

    // Стабильный идентификатор Google (sub) — только для Google OAuth
    // ВАЖНО: без default и без unique на поле
    googleId: {
      type: String,
    },

    // Основные поля
    email: {
      type: String,
      required: true,
      unique: true, // email уникален глобально для обоих провайдеров
      lowercase: true,
      trim: true,
      index: true,
    },

    // Опциональный username для локальной авторизации
    // ВАЖНО: без default и без unique на поле
    username: {
      type: String,
      trim: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-zA-Z0-9_]+$/,
    },

    // Пароль для локальной авторизации
    password: {
      type: String,
      required: function () {
        return this.provider === "local";
      },
      minlength: 6,
      select: false,
    },

    // Имя и фамилия
    firstName: { type: String, trim: true, maxlength: 50 },
    lastName: { type: String, trim: true, maxlength: 50 },

    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.USER,
      index: true,
    },

    // Верификация email
    isEmailVerified: {
      type: Boolean,
      default: function () {
        return this.provider === "google"; // Google — сразу верифицирован
      },
      index: true,
    },

    // deprecated: оставлено для совместимости
    isVerified: {
      type: Boolean,
      default: function () {
        return this.isEmailVerified;
      },
    },

    avatar: { type: String },
    bio: { type: String, maxlength: 500 },

    rating: { type: Number, default: 0, min: 0 },
    totalAnswers: { type: Number, default: 0, min: 0 },
    totalQuestions: { type: Number, default: 0, min: 0 },

    isActive: { type: Boolean, default: true, index: true },

    isBanned: { type: Boolean, default: false, index: true },
    bannedUntil: { type: Date },
    bannedReason: { type: String },

    lastLoginAt: { type: Date },

    roleChangedAt: { type: Date },
    roleChangedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Восстановление пароля
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },

    // Брутфорс-защита
    loginAttempts: { type: Number, default: 0, min: 0 },
    lockUntil: { type: Date },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ==================== ИНДЕКСЫ ====================
// Частичный уникальный индекс: уникален только когда значение существует и не null
userSchema.index(
  { googleId: 1 },
  {
    unique: true,
    partialFilterExpression: { googleId: { $exists: true, $ne: null } },
  }
);

userSchema.index(
  { username: 1 },
  {
    unique: true,
    partialFilterExpression: { username: { $exists: true, $ne: null } },
  }
);

// Производственные индексы
userSchema.index({ email: 1, provider: 1 });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ isEmailVerified: 1, provider: 1 });
userSchema.index({ lockUntil: 1 }, { sparse: true });
userSchema.index({ bannedUntil: 1 }, { sparse: true });

// ==================== ВИРТУАЛЫ ====================
userSchema.virtual("fullName").get(function () {
  if (this.firstName && this.lastName)
    return `${this.firstName} ${this.lastName}`;
  if (this.firstName) return this.firstName;
  if (this.lastName) return this.lastName;
  return this.email;
});

userSchema.virtual("displayName").get(function () {
  return this.username || this.fullName || this.email;
});

userSchema.virtual("isTemporarilyBanned").get(function () {
  return this.bannedUntil && this.bannedUntil.getTime() > Date.now();
});

// ==================== МЕТОДЫ ЭКЗЕМПЛЯРА ====================

userSchema.methods.isBannedCurrently = function () {
  if (!this.isBanned) return false;

  // Постоянный бан
  if (!this.bannedUntil) return true;

  // Временный бан
  if (this.bannedUntil.getTime() > Date.now()) return true;

  // Бан истёк — подчистим локально (сохранение делать снаружи по необходимости)
  this.isBanned = false;
  this.bannedUntil = null;
  this.bannedReason = null;
  return false;
};

userSchema.methods.isAccountLocked = function () {
  return !!(this.lockUntil && this.lockUntil.getTime() > Date.now());
};

// Увеличение попыток входа и блокировка при необходимости
userSchema.methods.incLoginAttempts = async function () {
  const updates = { $inc: { loginAttempts: 1 } };

  // Если это 5-я попытка, блокируем на 30 минут
  if (this.loginAttempts + 1 >= 5 && !this.isAccountLocked()) {
    updates.$set = { lockUntil: new Date(Date.now() + 30 * 60 * 1000) };
  }

  return this.updateOne(updates);
};

// Сброс попыток входа
userSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({ $unset: { loginAttempts: 1, lockUntil: 1 } });
};

// Токен для сброса пароля
userSchema.methods.generatePasswordResetToken = function () {
  const resetToken = generateSecureToken(16); // 32 hex
  this.passwordResetToken = resetToken;
  this.passwordResetExpires = new Date(Date.now() + 10 * 60 * 1000);
  return resetToken;
};

// Роли
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

// Доступ к функциям
userSchema.methods.canAccessFeatures = function () {
  return this.isEmailVerified && this.isActive && !this.isBannedCurrently();
};

userSchema.methods.canModerate = function () {
  return this.role === USER_ROLES.ADMIN;
};

// Статистика
userSchema.methods.incrementQuestionCount = function () {
  this.totalQuestions += 1;
  return this.save();
};
userSchema.methods.incrementAnswerCount = function () {
  this.totalAnswers += 1;
  return this.save();
};
userSchema.methods.updateRating = function (change) {
  this.rating = Math.max(0, this.rating + change);
  return this.save();
};

// ==================== СТАТИЧЕСКИЕ ====================
userSchema.statics.findActiveExperts = function () {
  return this.find({
    role: { $in: [USER_ROLES.EXPERT, USER_ROLES.ADMIN] },
    isActive: true,
    isBanned: false,
  }).sort({ rating: -1, totalAnswers: -1 });
};

userSchema.statics.findByRole = function (role) {
  return this.find({ role, isActive: true }).sort({ createdAt: -1 });
};

// Поиск для локальной авторизации
userSchema.statics.findByEmailOrUsername = function (
  login,
  includePassword = false
) {
  const query = this.findOne({
    $or: [{ email: login.toLowerCase() }, { username: login }],
    provider: "local",
  });
  if (includePassword) query.select("+password");
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

userSchema.pre("save", async function (next) {
  // Хешируем пароль только если изменился
  if (this.isModified("password")) {
    this.password = await hashPassword(this.password);
  }

  // Отслеживаем смену роли
  if (this.isModified("role")) {
    this.roleChangedAt = new Date();
  }

  // Если разбанили — очищаем поля
  if (this.isModified("isBanned") && !this.isBanned) {
    this.bannedUntil = null;
    this.bannedReason = null;
  }

  // Синхронизация со старым полем
  if (this.isModified("isEmailVerified")) {
    this.isVerified = this.isEmailVerified;
  }

  next();
});

userSchema.post("save", function (doc) {
  if (doc.isModified("role")) {
    console.log(`User role changed: ${doc.email} -> ${doc.role}`);
  }
});

const User = mongoose.model("User", userSchema);
export default User;
