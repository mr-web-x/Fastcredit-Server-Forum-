import mongoose from "mongoose";
import {
  QUESTION_STATUS,
  QUESTION_PRIORITY,
  DEFAULT_CATEGORIES,
} from "../utils/constants.js";

const questionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 200,
      index: "text",
    },
    content: {
      type: String,
      required: true,
      trim: true,
      minlength: 20,
      maxlength: 5000,
      index: "text",
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    category: {
      type: String,
      default: DEFAULT_CATEGORIES.GENERAL,
      index: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(QUESTION_STATUS),
      default: QUESTION_STATUS.PENDING,
      index: true,
    },
    priority: {
      type: String,
      enum: Object.values(QUESTION_PRIORITY),
      default: QUESTION_PRIORITY.MEDIUM,
      index: true,
    },
    views: {
      type: Number,
      default: 0,
      min: 0,
    },
    likes: {
      type: Number,
      default: 0,
      min: 0,
    },
    hasAcceptedAnswer: {
      type: Boolean,
      default: false,
      index: true,
    },
    answersCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    commentsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isModerated: {
      type: Boolean,
      default: false,
      index: true,
    },
    moderatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    moderatedAt: {
      type: Date,
      default: null,
    },
    answeredAt: {
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

// Составные индексы для производительности
questionSchema.index({ status: 1, createdAt: -1 });
questionSchema.index({ author: 1, createdAt: -1 });
questionSchema.index({ category: 1, status: 1 });
questionSchema.index({ hasAcceptedAnswer: 1, status: 1 });
questionSchema.index({ views: -1 });
questionSchema.index({ likes: -1 });

// Текстовый поиск
questionSchema.index(
  {
    title: "text",
    content: "text",
  },
  {
    weights: {
      title: 10,
      content: 5,
    },
  }
);

// Виртуальные поля
questionSchema.virtual("isAnswered").get(function () {
  return this.status === QUESTION_STATUS.ANSWERED;
});

questionSchema.virtual("isPending").get(function () {
  return this.status === QUESTION_STATUS.PENDING;
});

questionSchema.virtual("isClosed").get(function () {
  return this.status === QUESTION_STATUS.CLOSED;
});

questionSchema.virtual("url").get(function () {
  return `/forum/questions-to-expert/${this.slug}`;
});

// Методы экземпляра
questionSchema.methods.incrementViews = async function () {
  this.views += 1;
  return await this.save({ validateBeforeSave: false });
};

questionSchema.methods.incrementLikes = async function () {
  this.likes += 1;
  return await this.save({ validateBeforeSave: false });
};

questionSchema.methods.decrementLikes = async function () {
  this.likes = Math.max(0, this.likes - 1);
  return await this.save({ validateBeforeSave: false });
};

questionSchema.methods.markAsAnswered = async function () {
  this.status = QUESTION_STATUS.ANSWERED;
  this.answeredAt = new Date();
  return await this.save();
};

questionSchema.methods.acceptAnswer = async function () {
  this.hasAcceptedAnswer = true;
  return await this.save();
};

questionSchema.methods.incrementAnswers = async function () {
  this.answersCount += 1;
  return await this.save({ validateBeforeSave: false });
};

questionSchema.methods.decrementAnswers = async function () {
  this.answersCount = Math.max(0, this.answersCount - 1);
  return await this.save({ validateBeforeSave: false });
};

questionSchema.methods.incrementComments = async function () {
  this.commentsCount += 1;
  return await this.save({ validateBeforeSave: false });
};

questionSchema.methods.decrementComments = async function () {
  this.commentsCount = Math.max(0, this.commentsCount - 1);
  return await this.save({ validateBeforeSave: false });
};

// Статические методы
questionSchema.statics.findByStatus = function (status) {
  return this.find({ status })
    .populate("author", "email role avatar")
    .sort({ createdAt: -1 });
};

questionSchema.statics.findPending = function () {
  return this.find({ status: QUESTION_STATUS.PENDING })
    .populate("author", "email role avatar")
    .sort({ priority: -1, createdAt: -1 });
};

questionSchema.statics.findAnswered = function () {
  return this.find({ status: QUESTION_STATUS.ANSWERED })
    .populate("author", "email role avatar")
    .sort({ answeredAt: -1 });
};

questionSchema.statics.findByAuthor = function (authorId) {
  return this.find({ author: authorId }).sort({ createdAt: -1 });
};

questionSchema.statics.search = function (query, limit = 10) {
  return this.find(
    { $text: { $search: query } },
    { score: { $meta: "textScore" } }
  )
    .populate("author", "email role avatar")
    .sort({ score: { $meta: "textScore" } })
    .limit(limit);
};

questionSchema.statics.getStatistics = async function () {
  const stats = await this.aggregate([
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        avgViews: { $avg: "$views" },
        avgLikes: { $avg: "$likes" },
      },
    },
  ]);

  const totalQuestions = await this.countDocuments();
  const unanswered = await this.countDocuments({
    status: QUESTION_STATUS.PENDING,
  });
  const withAcceptedAnswer = await this.countDocuments({
    hasAcceptedAnswer: true,
  });

  return {
    total: totalQuestions,
    unanswered,
    withAcceptedAnswer,
    byStatus: stats,
  };
};

// Pre-save middleware
questionSchema.pre("save", function (next) {
  // Автоматическое обновление статуса при принятии ответа
  if (this.isModified("hasAcceptedAnswer") && this.hasAcceptedAnswer) {
    this.status = QUESTION_STATUS.ANSWERED;
    if (!this.answeredAt) {
      this.answeredAt = new Date();
    }
  }

  next();
});

// Pre-remove middleware
questionSchema.pre("deleteOne", { document: true }, async function () {
  // Уменьшаем счетчик вопросов у автора
  await mongoose
    .model("User")
    .findByIdAndUpdate(this.author, { $inc: { totalQuestions: -1 } });
});

const Question = mongoose.model("Question", questionSchema);

export default Question;
