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
      unique: true,
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

    // Попытки входа (для защиты от брутфорса)
    loginAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    lockUntil: {
      type: Date,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        // Удаляем чувствительные данные из JSON
        delete ret.password;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        delete ret.loginAttempts;
        delete ret.lockUntil;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// Индексы для производительности
userSchema.index({ createdAt: -1 });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ isBanned: 1, bannedUntil: 1 });
userSchema.index({ isEmailVerified: 1 });
userSchema.index({ provider: 1 });

// Виртуальные поля
userSchema.virtual("fullName").get(function () {
  if (this.firstName && this.lastName) {
    return `${this.firstName} ${this.lastName}`;
  }
  return this.firstName || this.lastName || this.username || this.email;
});

userSchema.virtual("isExpert").get(function () {
  return this.role === USER_ROLES.EXPERT || this.role === USER_ROLES.ADMIN;
});

userSchema.virtual("isAdmin").get(function () {
  return this.role === USER_ROLES.ADMIN;
});

userSchema.virtual("canAnswer").get(function () {
  return this.isExpert && this.isActive && !this.isBanned;
});

userSchema.virtual("canModerate").get(function () {
  return this.isAdmin && this.isActive && !this.isBanned;
});

userSchema.virtual("isAccountLocked").get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Методы экземпляра (бизнес-логика, НЕ криптография)
userSchema.methods.isBannedCurrently = function () {
  if (!this.isBanned) return false;
  if (!this.bannedUntil) return true; // перманентный бан
  return new Date() < this.bannedUntil;
};

userSchema.methods.canPerformAction = function () {
  return this.isActive && !this.isBannedCurrently() && !this.isAccountLocked;
};

userSchema.methods.incrementQuestions = async function () {
  this.totalQuestions += 1;
  return await this.save();
};

userSchema.methods.incrementAnswers = async function () {
  this.totalAnswers += 1;
  return await this.save();
};

userSchema.methods.updateRating = async function (newRating) {
  this.rating = Math.max(0, newRating); // рейтинг не может быть отрицательным
  return await this.save();
};

// Методы для защиты от брутфорса
userSchema.methods.incLoginAttempts = async function () {
  // Если аккаунт уже заблокирован и блокировка истекла, сбрасываем
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return await this.updateOne({
      $unset: {
        loginAttempts: 1,
        lockUntil: 1,
      },
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  // Блокируем после 5 неудачных попыток на 30 минут
  if (this.loginAttempts + 1 >= 5 && !this.isAccountLocked) {
    updates.$set = {
      lockUntil: Date.now() + 30 * 60 * 1000, // 30 минут
    };
  }

  return await this.updateOne(updates);
};

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

// Статические методы
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
