// models/Comment.js
import mongoose from "mongoose";

const commentSchema = new mongoose.Schema(
  {
    content: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 1000,
    },
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
      index: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    parentComment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Comment",
      default: null,
      index: true,
    },
    isApproved: {
      type: Boolean,
      default: true,
      index: true,
    },
    moderatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    likes: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Составные индексы
commentSchema.index({ questionId: 1, createdAt: -1 });
commentSchema.index({ author: 1, createdAt: -1 });
commentSchema.index({ parentComment: 1, createdAt: 1 });
commentSchema.index({ isApproved: 1, createdAt: -1 });

// Виртуальные поля
commentSchema.virtual("isReply").get(function () {
  return !!this.parentComment;
});

commentSchema.virtual("isTopLevel").get(function () {
  return !this.parentComment;
});

// Виртуальная связь для получения ответов
commentSchema.virtual("replies", {
  ref: "Comment",
  localField: "_id",
  foreignField: "parentComment",
  options: { sort: { createdAt: 1 } },
});

// Методы экземпляра
commentSchema.methods.incrementLikes = async function () {
  this.likes += 1;
  return await this.save({ validateBeforeSave: false });
};

commentSchema.methods.decrementLikes = async function () {
  this.likes = Math.max(0, this.likes - 1);
  return await this.save({ validateBeforeSave: false });
};

commentSchema.methods.moderate = async function (
  moderatorId,
  isApproved = true
) {
  this.isApproved = isApproved;
  this.moderatedBy = moderatorId;
  return await this.save();
};

// Статические методы
commentSchema.statics.findByQuestion = function (questionId) {
  return this.find({
    questionId,
    isApproved: true,
    parentComment: null,
  })
    .populate("author", "firstName lastName email role avatar")
    .populate({
      path: "replies",
      populate: {
        path: "author",
        select: "email role avatar",
      },
    })
    .sort({ createdAt: 1 });
};

commentSchema.statics.findReplies = function (parentCommentId) {
  return this.find({
    parentComment: parentCommentId,
    isApproved: true,
  })
    .populate("author", "firstName lastName email role avatar")
    .sort({ createdAt: 1 });
};

commentSchema.statics.findByAuthor = function (authorId) {
  return this.find({ author: authorId, isApproved: true })
    .populate("questionId", "title slug")
    .sort({ createdAt: -1 });
};

commentSchema.statics.findPendingModeration = function () {
  return this.find({ isApproved: false })
    .populate("author", "firstName lastName email role avatar")
    .populate("questionId", "title slug")
    .sort({ createdAt: -1 });
};

commentSchema.statics.getStatistics = async function () {
  const total = await this.countDocuments();
  const approved = await this.countDocuments({ isApproved: true });
  const pending = await this.countDocuments({ isApproved: false });
  const topLevel = await this.countDocuments({ parentComment: null });
  const replies = await this.countDocuments({ parentComment: { $ne: null } });

  return {
    total,
    approved,
    pending,
    topLevel,
    replies,
  };
};

// Pre-save middleware
commentSchema.pre("save", async function (next) {
  // Увеличиваем счетчик комментариев у вопроса при создании
  if (this.isNew) {
    await mongoose
      .model("Question")
      .findByIdAndUpdate(this.questionId, { $inc: { commentsCount: 1 } });
  }
  next();
});

// Pre-remove middleware
commentSchema.pre("deleteOne", { document: true }, async function () {
  // Уменьшаем счетчик комментариев у вопроса
  await mongoose
    .model("Question")
    .findByIdAndUpdate(this.questionId, { $inc: { commentsCount: -1 } });

  // Удаляем все ответы на этот комментарий
  await mongoose.model("Comment").deleteMany({
    parentComment: this._id,
  });
});

// Post-remove middleware для обновления счетчиков при удалении ответов
commentSchema.post("deleteMany", async function (result) {
  if (result.deletedCount > 0) {
    // Находим все вопросы, которые затронуты
    const affectedQuestions = await this.model.distinct(
      "questionId",
      this.getFilter()
    );

    // Обновляем счетчики для каждого вопроса
    for (const questionId of affectedQuestions) {
      const commentsCount = await this.model.countDocuments({
        questionId,
        isApproved: true,
      });

      await mongoose
        .model("Question")
        .findByIdAndUpdate(questionId, { commentsCount });
    }
  }
});

const Comment = mongoose.model("Comment", commentSchema);

export default Comment;
