// models/Category.js
import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 100,
      index: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    description: {
      type: String,
      maxlength: 500,
      trim: true,
      default: null,
    },
    icon: {
      type: String,
      default: null,
    },
    color: {
      type: String,
      default: "#6B7280",
      match: /^#[0-9A-F]{6}$/i,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
      index: true,
    },
    questionsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    expertsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    parentCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Индексы
categorySchema.index({ isActive: 1, sortOrder: 1 });
categorySchema.index({ parentCategory: 1, sortOrder: 1 });

// Виртуальные поля
categorySchema.virtual("isParent").get(function () {
  return !this.parentCategory;
});

categorySchema.virtual("hasQuestions").get(function () {
  return this.questionsCount > 0;
});

categorySchema.virtual("hasExperts").get(function () {
  return this.expertsCount > 0;
});

// Виртуальная связь для подкategорий
categorySchema.virtual("subcategories", {
  ref: "Category",
  localField: "_id",
  foreignField: "parentCategory",
  options: { sort: { sortOrder: 1, name: 1 } },
});

// Методы экземпляра
categorySchema.methods.incrementQuestions = async function () {
  this.questionsCount += 1;
  return await this.save({ validateBeforeSave: false });
};

categorySchema.methods.decrementQuestions = async function () {
  this.questionsCount = Math.max(0, this.questionsCount - 1);
  return await this.save({ validateBeforeSave: false });
};

categorySchema.methods.incrementExperts = async function () {
  this.expertsCount += 1;
  return await this.save({ validateBeforeSave: false });
};

categorySchema.methods.decrementExperts = async function () {
  this.expertsCount = Math.max(0, this.expertsCount - 1);
  return await this.save({ validateBeforeSave: false });
};

categorySchema.methods.updateCounts = async function () {
  const questionsCount = await mongoose.model("Question").countDocuments({
    category: this.slug,
    status: { $ne: "closed" },
  });

  // Подсчет экспертов можно расширить в будущем
  this.questionsCount = questionsCount;
  return await this.save({ validateBeforeSave: false });
};

// Статические методы
categorySchema.statics.findActive = function () {
  return this.find({ isActive: true })
    .populate("subcategories")
    .sort({ sortOrder: 1, name: 1 });
};

categorySchema.statics.findParentCategories = function () {
  return this.find({
    isActive: true,
    parentCategory: null,
  })
    .populate("subcategories")
    .sort({ sortOrder: 1, name: 1 });
};

categorySchema.statics.findBySlug = function (slug) {
  return this.findOne({ slug, isActive: true })
    .populate("subcategories")
    .populate("parentCategory");
};

categorySchema.statics.getHierarchy = async function () {
  const categories = await this.find({ isActive: true }).sort({
    sortOrder: 1,
    name: 1,
  });

  // Группируем по родительским категориям
  const hierarchy = [];
  const categoryMap = new Map();

  // Сначала обрабатываем родительские категории
  categories.forEach((category) => {
    categoryMap.set(category._id.toString(), category);
    if (!category.parentCategory) {
      hierarchy.push({
        ...category.toObject(),
        children: [],
      });
    }
  });

  // Затем добавляем дочерние категории
  categories.forEach((category) => {
    if (category.parentCategory) {
      const parentIndex = hierarchy.findIndex(
        (parent) => parent._id.toString() === category.parentCategory.toString()
      );
      if (parentIndex !== -1) {
        hierarchy[parentIndex].children.push(category);
      }
    }
  });

  return hierarchy;
};

categorySchema.statics.getPopularCategories = function (limit = 10) {
  return this.find({
    isActive: true,
    questionsCount: { $gt: 0 },
  })
    .sort({ questionsCount: -1, name: 1 })
    .limit(limit);
};

categorySchema.statics.getStatistics = async function () {
  const total = await this.countDocuments();
  const active = await this.countDocuments({ isActive: true });
  const withQuestions = await this.countDocuments({
    questionsCount: { $gt: 0 },
  });

  const totalQuestions = await this.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: "$questionsCount" },
      },
    },
  ]);

  const topCategories = await this.find({ isActive: true })
    .sort({ questionsCount: -1 })
    .limit(5)
    .select("name slug questionsCount");

  return {
    total,
    active,
    withQuestions,
    totalQuestions: totalQuestions[0]?.total || 0,
    topCategories,
  };
};

categorySchema.statics.searchCategories = function (query) {
  return this.find({
    isActive: true,
    $or: [
      { name: { $regex: query, $options: "i" } },
      { description: { $regex: query, $options: "i" } },
    ],
  }).sort({ questionsCount: -1, name: 1 });
};

// Pre-save middleware
categorySchema.pre("save", function (next) {
  // Валидация цвета
  if (this.color && !this.color.match(/^#[0-9A-F]{6}$/i)) {
    this.color = "#6B7280"; // дефолтный серый цвет
  }

  next();
});

// Pre-remove middleware
categorySchema.pre("deleteOne", { document: true }, async function () {
  // Проверяем, есть ли вопросы в этой категории
  const questionsCount = await mongoose.model("Question").countDocuments({
    category: this.slug,
  });

  if (questionsCount > 0) {
    throw new Error("Cannot delete category with existing questions");
  }

  // Переводим подкategории в родительскую или делаем их независимыми
  await this.constructor.updateMany(
    { parentCategory: this._id },
    { parentCategory: this.parentCategory }
  );
});

const Category = mongoose.model("Category", categorySchema);

export default Category;
