import mongoose from 'mongoose';
import { USER_ROLES } from '../utils/constants.js';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  role: {
    type: String,
    enum: Object.values(USER_ROLES),
    default: USER_ROLES.USER,
    index: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  avatar: {
    type: String,
    default: null
  },
  bio: {
    type: String,
    maxlength: 500,
    default: null
  },
  rating: {
    type: Number,
    default: 0,
    min: 0
  },
  totalAnswers: {
    type: Number,
    default: 0,
    min: 0
  },
  totalQuestions: {
    type: Number,
    default: 0,
    min: 0
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  isBanned: {
    type: Boolean,
    default: false,
    index: true
  },
  bannedUntil: {
    type: Date,
    default: null
  },
  bannedReason: {
    type: String,
    default: null
  },
  lastLoginAt: {
    type: Date,
    default: null
  },
  roleChangedAt: {
    type: Date,
    default: null
  },
  roleChangedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Индексы для производительности
userSchema.index({ createdAt: -1 });
userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ isBanned: 1, bannedUntil: 1 });

// Виртуальные поля
userSchema.virtual('isExpert').get(function() {
  return this.role === USER_ROLES.EXPERT || this.role === USER_ROLES.ADMIN;
});

userSchema.virtual('isAdmin').get(function() {
  return this.role === USER_ROLES.ADMIN;
});

userSchema.virtual('canAnswer').get(function() {
  return this.isExpert && this.isActive && !this.isBanned;
});

userSchema.virtual('canModerate').get(function() {
  return this.isAdmin && this.isActive && !this.isBanned;
});

// Методы экземпляра
userSchema.methods.isBannedCurrently = function() {
  if (!this.isBanned) return false;
  if (!this.bannedUntil) return true; // перманентный бан
  return new Date() < this.bannedUntil;
};

userSchema.methods.canPerformAction = function() {
  return this.isActive && !this.isBannedCurrently();
};

userSchema.methods.incrementQuestions = async function() {
  this.totalQuestions += 1;
  return await this.save();
};

userSchema.methods.incrementAnswers = async function() {
  this.totalAnswers += 1;
  return await this.save();
};

userSchema.methods.updateRating = async function(newRating) {
  this.rating = Math.max(0, newRating); // рейтинг не может быть отрицательным
  return await this.save();
};

// Статические методы
userSchema.statics.findActiveExperts = function() {
  return this.find({
    role: { $in: [USER_ROLES.EXPERT, USER_ROLES.ADMIN] },
    isActive: true,
    isBanned: false
  }).sort({ rating: -1, totalAnswers: -1 });
};

userSchema.statics.findByRole = function(role) {
  return this.find({
    role,
    isActive: true
  }).sort({ createdAt: -1 });
};

userSchema.statics.getStatistics = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$role',
        count: { $sum: 1 },
        active: { $sum: { $cond: ['$isActive', 1, 0] } },
        banned: { $sum: { $cond: ['$isBanned', 1, 0] } }
      }
    }
  ]);
  
  return stats.reduce((acc, stat) => {
    acc[stat._id] = {
      total: stat.count,
      active: stat.active,
      banned: stat.banned
    };
    return acc;
  }, {});
};

// Pre-save middleware
userSchema.pre('save', function(next) {
  // Если роль изменилась, обновляем roleChangedAt
  if (this.isModified('role')) {
    this.roleChangedAt = new Date();
  }
  
  // Если пользователь разбанен, очищаем поля бана
  if (this.isModified('isBanned') && !this.isBanned) {
    this.bannedUntil = null;
    this.bannedReason = null;
  }
  
  next();
});

// Post-save middleware для логирования
userSchema.post('save', function(doc) {
  if (doc.isModified('role')) {
    console.log(`User role changed: ${doc.email} -> ${doc.role}`);
  }
});

const User = mongoose.model('User', userSchema);

export default User;