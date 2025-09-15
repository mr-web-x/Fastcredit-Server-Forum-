// models/Answer.js
import mongoose from "mongoose";

const answerSchema = new mongoose.Schema(
  {
    content: {
      type: String,
      required: true,
      trim: true,
      minlength: 50,
      maxlength: 10000,
    },
    questionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
      required: true,
      index: true,
    },
    expert: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    isApproved: {
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
    moderationComment: {
      type: String,
      default: null,
    },
    likes: {
      type: Number,
      default: 0,
      min: 0,
    },
    isAccepted: {
      type: Boolean,
      default: false,
      index: true,
    },
    wasApproved: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Составные индексы
answerSchema.index({ questionId: 1, createdAt: -1 });
answerSchema.index({ expert: 1, createdAt: -1 });
answerSchema.index({ isApproved: 1, createdAt: -1 });
answerSchema.index({ questionId: 1, isAccepted: 1 });

// Виртуальные поля
answerSchema.virtual("isPending").get(function () {
  return !this.isApproved;
});

answerSchema.virtual("isPublished").get(function () {
  return this.isApproved;
});

// Методы экземпляра
answerSchema.methods.approve = async function (moderatorId, comment = null) {
  this.isApproved = true;
  this.wasApproved = true;
  this.moderatedBy = moderatorId;
  this.moderatedAt = new Date();
  this.moderationComment = comment;

  // Обновляем статус вопроса и счетчик ответов
  await mongoose.model("Question").findByIdAndUpdate(this.questionId, {
    status: "answered",
    answeredAt: new Date(),
  });

  // Увеличиваем счетчик ответов у эксперта
  await mongoose.model("User").findByIdAndUpdate(this.expert, {
    $inc: { totalAnswers: 1 },
  });

  return await this.save();
};

answerSchema.methods.reject = async function (moderatorId, comment = null) {
  this.isApproved = false;
  this.moderatedBy = moderatorId;
  this.moderatedAt = new Date();
  this.moderationComment = comment;
  return await this.save();
};

answerSchema.methods.accept = async function () {
  // Снимаем статус принятого с других ответов на этот вопрос
  await mongoose
    .model("Answer")
    .updateMany(
      { questionId: this.questionId, _id: { $ne: this._id } },
      { isAccepted: false }
    );

  this.isAccepted = true;

  // Отмечаем вопрос как имеющий принятый ответ
  await mongoose.model("Question").findByIdAndUpdate(this.questionId, {
    hasAcceptedAnswer: true,
  });

  return await this.save();
};

answerSchema.methods.incrementLikes = async function () {
  this.likes += 1;
  return await this.save({ validateBeforeSave: false });
};

answerSchema.methods.decrementLikes = async function () {
  this.likes = Math.max(0, this.likes - 1);
  return await this.save({ validateBeforeSave: false });
};

// Статические методы
answerSchema.statics.findPendingModeration = function () {
  return this.find({ isApproved: false })
    .populate("expert", "firstName lastName email role avatar")
    .populate("questionId", "title slug")
    .sort({ createdAt: -1 });
};

answerSchema.statics.findByQuestion = function (questionId) {
  return this.find({ questionId, isApproved: true })
    .populate("expert", "firstName lastName email role avatar bio rating")
    .sort({ isAccepted: -1, likes: -1, createdAt: -1 });
};

answerSchema.statics.findByExpert = function (expertId) {
  return this.find({ expert: expertId, isApproved: true })
    .populate("questionId", "title slug")
    .sort({ createdAt: -1 });
};

answerSchema.statics.getStatistics = async function () {
  const total = await this.countDocuments();
  const approved = await this.countDocuments({ isApproved: true });
  const pending = await this.countDocuments({ isApproved: false });
  const accepted = await this.countDocuments({ isAccepted: true });

  return {
    total,
    approved,
    pending,
    accepted,
    approvalRate: total > 0 ? ((approved / total) * 100).toFixed(2) : 0,
  };
};

// Pre-remove middleware
answerSchema.pre("deleteOne", { document: true }, async function () {
  // Уменьшаем счетчик ответов у вопроса
  await mongoose
    .model("Question")
    .findByIdAndUpdate(this.questionId, { $inc: { answersCount: -1 } });

  // Уменьшаем счетчик ответов у эксперта
  if (this.isApproved) {
    await mongoose
      .model("User")
      .findByIdAndUpdate(this.expert, { $inc: { totalAnswers: -1 } });
  }

  // Если это был принятый ответ, убираем отметку у вопроса
  if (this.isAccepted) {
    await mongoose
      .model("Question")
      .findByIdAndUpdate(this.questionId, { hasAcceptedAnswer: false });
  }
});

const Answer = mongoose.model("Answer", answerSchema);

export default Answer;
