да// models/Like.js
import mongoose from 'mongoose';
import { LIKE_TARGET_TYPES } from '../utils/constants.js';

const likeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  targetType: {
    type: String,
    enum: Object.values(LIKE_TARGET_TYPES),
    required: true,
    index: true
  }
}, {
  timestamps: true
});

// Составные индексы для уникальности и производительности
likeSchema.index({ userId: 1, targetId: 1, targetType: 1 }, { unique: true });
likeSchema.index({ targetId: 1, targetType: 1 });
likeSchema.index({ userId: 1, createdAt: -1 });

// Статические методы
likeSchema.statics.toggleLike = async function(userId, targetId, targetType) {
  try {
    const existingLike = await this.findOne({ userId, targetId, targetType });
    
    if (existingLike) {
      // Убираем лайк
      await existingLike.deleteOne();
      await this.decrementLikeCount(targetId, targetType);
      return { action: 'removed', liked: false };
    } else {
      // Добавляем лайк
      await this.create({ userId, targetId, targetType });
      await this.incrementLikeCount(targetId, targetType);
      return { action: 'added', liked: true };
    }
  } catch (error) {
    if (error.code === 11000) {
      // Дублирующий лайк - возвращаем текущее состояние
      return { action: 'duplicate', liked: true };
    }
    throw error;
  }
};

likeSchema.statics.isLiked = async function(userId, targetId, targetType) {
  const like = await this.findOne({ userId, targetId, targetType });
  return !!like;
};

likeSchema.statics.getLikeCount = async function(targetId, targetType) {
  return await this.countDocuments({ targetId, targetType });
};

likeSchema.statics.getUserLikes = async function(userId, targetType = null) {
  const filter = { userId };
  if (targetType) {
    filter.targetType = targetType;
  }
  
  return await this.find(filter)
    .populate('targetId')
    .sort({ createdAt: -1 });
};

likeSchema.statics.getPopularContent = async function(targetType, limit = 10) {
  const pipeline = [
    { $match: { targetType } },
    { $group: {
      _id: '$targetId',
      likesCount: { $sum: 1 },
      lastLiked: { $max: '$createdAt' }
    }},
    { $sort: { likesCount: -1, lastLiked: -1 } },
    { $limit: limit }
  ];
  
  return await this.aggregate(pipeline);
};

// Вспомогательные методы для обновления счетчиков
likeSchema.statics.incrementLikeCount = async function(targetId, targetType) {
  let model;
  switch (targetType) {
    case LIKE_TARGET_TYPES.QUESTION:
      model = mongoose.model('Question');
      break;
    case LIKE_TARGET_TYPES.ANSWER:
      model = mongoose.model('Answer');
      break;
    case LIKE_TARGET_TYPES.COMMENT:
      model = mongoose.model('Comment');
      break;
    default:
      return;
  }
  
  await model.findByIdAndUpdate(targetId, { $inc: { likes: 1 } });
};

likeSchema.statics.decrementLikeCount = async function(targetId, targetType) {
  let model;
  switch (targetType) {
    case LIKE_TARGET_TYPES.QUESTION:
      model = mongoose.model('Question');
      break;
    case LIKE_TARGET_TYPES.ANSWER:
      model = mongoose.model('Answer');
      break;
    case LIKE_TARGET_TYPES.COMMENT:
      model = mongoose.model('Comment');
      break;
    default:
      return;
  }
  
  await model.findByIdAndUpdate(
    targetId, 
    { $inc: { likes: -1 } },
    { new: true }
  ).then(doc => {
    // Убеждаемся, что likes не уходит в минус
    if (doc && doc.likes < 0) {
      doc.likes = 0;
      doc.save({ validateBeforeSave: false });
    }
  });
};

likeSchema.statics.getStatistics = async function() {
  const total = await this.countDocuments();
  const byType = await this.aggregate([
    {
      $group: {
        _id: '$targetType',
        count: { $sum: 1 }
      }
    }
  ]);
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayLikes = await this.countDocuments({ 
    createdAt: { $gte: today } 
  });
  
  return {
    total,
    today: todayLikes,
    byType: byType.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {})
  };
};

// Pre-remove middleware для очистки счетчиков
likeSchema.pre('deleteOne', { document: true }, async function() {
  await this.constructor.decrementLikeCount(this.targetId, this.targetType);
});

const Like = mongoose.model('Like', likeSchema);

export default Like;