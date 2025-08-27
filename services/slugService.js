// services/slugService.js
import slugify from "slugify";
import Question from "../models/Question.js";
import Category from "../models/Category.js";
import { logError } from "../middlewares/logger.js";

class SlugService {
  // Конфигурация для slugify
  getSlugifyOptions() {
    return {
      lower: true,
      strict: true,
      locale: "en",
      trim: true,
      remove: /[*+~.()'"!:@]/g,
    };
  }

  // Создание базового slug из текста
  createBaseSlug(text) {
    try {
      if (!text || typeof text !== "string") {
        throw new Error("Text is required and must be a string");
      }

      // Предварительная очистка текста
      let cleanText = text
        .replace(/[^\w\s\u0400-\u04FF-]/g, "") // оставляем только буквы, цифры, пробелы и кириллицу
        .replace(/\s+/g, " ") // множественные пробелы в один
        .trim();

      // Если после очистки текст пустой, используем дефолт
      if (!cleanText) {
        cleanText = "untitled";
      }

      // Транслитерация кириллицы
      cleanText = this.transliterateCyrillic(cleanText);

      // Генерируем slug
      const slug = slugify(cleanText, this.getSlugifyOptions());

      // Проверяем минимальную длину
      if (slug.length < 3) {
        return `item-${Date.now()}`;
      }

      // Ограничиваем максимальную длину
      return slug.substring(0, 100);
    } catch (error) {
      logError(error, "SlugService.createBaseSlug");
      return `item-${Date.now()}`;
    }
  }

  // Транслитерация кириллицы в латиницу
  transliterateCyrillic(text) {
    const cyrillicMap = {
      а: "a",
      б: "b",
      в: "v",
      г: "g",
      д: "d",
      е: "e",
      ё: "yo",
      ж: "zh",
      з: "z",
      и: "i",
      й: "y",
      к: "k",
      л: "l",
      м: "m",
      н: "n",
      о: "o",
      п: "p",
      р: "r",
      с: "s",
      т: "t",
      у: "u",
      ф: "f",
      х: "h",
      ц: "c",
      ч: "ch",
      ш: "sh",
      щ: "sch",
      ъ: "",
      ы: "y",
      ь: "",
      э: "e",
      ю: "yu",
      я: "ya",
      А: "A",
      Б: "B",
      В: "V",
      Г: "G",
      Д: "D",
      Е: "E",
      Ё: "Yo",
      Ж: "Zh",
      З: "Z",
      И: "I",
      Й: "Y",
      К: "K",
      Л: "L",
      М: "M",
      Н: "N",
      О: "O",
      П: "P",
      Р: "R",
      С: "S",
      Т: "T",
      У: "U",
      Ф: "F",
      Х: "H",
      Ц: "C",
      Ч: "Ch",
      Ш: "Sh",
      Щ: "Sch",
      Ъ: "",
      Ы: "Y",
      Ь: "",
      Э: "E",
      Ю: "Yu",
      Я: "Ya",
    };

    return text.replace(/[а-яёА-ЯЁ]/g, (match) => cyrillicMap[match] || match);
  }

  // Создание уникального slug для вопроса
  async generateUniqueQuestionSlug(title) {
    try {
      let baseSlug = this.createBaseSlug(title);
      let slug = baseSlug;
      let counter = 1;

      // Проверяем уникальность в цикле
      while (await this.isQuestionSlugExists(slug)) {
        slug = `${baseSlug}-${counter}`;
        counter++;

        // Предотвращаем бесконечный цикл
        if (counter > 1000) {
          slug = `${baseSlug}-${Date.now()}`;
          break;
        }
      }

      return slug;
    } catch (error) {
      logError(error, "SlugService.generateUniqueQuestionSlug");
      return `question-${Date.now()}`;
    }
  }

  // Создание уникального slug для категории
  async generateUniqueCategorySlug(name) {
    try {
      let baseSlug = this.createBaseSlug(name);
      let slug = baseSlug;
      let counter = 1;

      // Проверяем уникальность в цикле
      while (await this.isCategorySlugExists(slug)) {
        slug = `${baseSlug}-${counter}`;
        counter++;

        // Предотвращаем бесконечный цикл
        if (counter > 100) {
          slug = `${baseSlug}-${Date.now()}`;
          break;
        }
      }

      return slug;
    } catch (error) {
      logError(error, "SlugService.generateUniqueCategorySlug");
      return `category-${Date.now()}`;
    }
  }

  // Проверка существования slug для вопроса
  async isQuestionSlugExists(slug) {
    try {
      const exists = await Question.findOne({ slug });
      return !!exists;
    } catch (error) {
      logError(error, "SlugService.isQuestionSlugExists");
      return true; // В случае ошибки считаем, что существует
    }
  }

  // Проверка существования slug для категории
  async isCategorySlugExists(slug) {
    try {
      const exists = await Category.findOne({ slug });
      return !!exists;
    } catch (error) {
      logError(error, "SlugService.isCategorySlugExists");
      return true; // В случае ошибки считаем, что существует
    }
  }

  // Валидация slug
  validateSlug(slug) {
    try {
      if (!slug || typeof slug !== "string") {
        return { isValid: false, error: "Slug must be a non-empty string" };
      }

      // Проверяем формат slug
      const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
      if (!slugRegex.test(slug)) {
        return {
          isValid: false,
          error:
            "Slug must contain only lowercase letters, numbers, and hyphens",
        };
      }

      // Проверяем длину
      if (slug.length < 3) {
        return {
          isValid: false,
          error: "Slug must be at least 3 characters long",
        };
      }

      if (slug.length > 100) {
        return {
          isValid: false,
          error: "Slug must be no more than 100 characters long",
        };
      }

      // Проверяем, что slug не начинается и не заканчивается дефисом
      if (slug.startsWith("-") || slug.endsWith("-")) {
        return {
          isValid: false,
          error: "Slug cannot start or end with a hyphen",
        };
      }

      // Проверяем на множественные дефисы подряд
      if (slug.includes("--")) {
        return {
          isValid: false,
          error: "Slug cannot contain consecutive hyphens",
        };
      }

      // Проверяем на зарезервированные слова
      const reservedWords = [
        "api",
        "admin",
        "root",
        "www",
        "ftp",
        "mail",
        "test",
        "dev",
        "staging",
        "production",
        "localhost",
        "create",
        "edit",
        "delete",
        "new",
        "add",
        "remove",
        "update",
        "search",
        "filter",
        "sort",
      ];

      if (reservedWords.includes(slug)) {
        return { isValid: false, error: "Slug cannot be a reserved word" };
      }

      return { isValid: true };
    } catch (error) {
      logError(error, "SlugService.validateSlug");
      return { isValid: false, error: "Slug validation failed" };
    }
  }

  // Обновление slug для существующего вопроса
  async updateQuestionSlug(questionId, newTitle) {
    try {
      const question = await Question.findById(questionId);
      if (!question) {
        throw new Error("Question not found");
      }

      const newSlug = await this.generateUniqueQuestionSlug(newTitle);

      question.slug = newSlug;
      await question.save();

      return newSlug;
    } catch (error) {
      logError(error, "SlugService.updateQuestionSlug");
      throw error;
    }
  }

  // Поиск вопроса по slug с проверкой редиректов
  async findQuestionBySlug(slug) {
    try {
      const question = await Question.findOne({ slug }).populate(
        "author",
        "email role avatar"
      );

      if (question) {
        return { question, redirect: null };
      }

      // Если не найден, попробуем найти похожие slug (возможно был изменен)
      const similarSlugs = await Question.find({
        slug: { $regex: slug.substring(0, -2), $options: "i" },
      })
        .limit(3)
        .select("slug title")
        .sort({ createdAt: -1 });

      return { question: null, redirect: null, suggestions: similarSlugs };
    } catch (error) {
      logError(error, "SlugService.findQuestionBySlug");
      return { question: null, redirect: null, suggestions: [] };
    }
  }

  // Генерация slug из различных источников текста
  generateSlugFromMultipleSources(...texts) {
    try {
      // Объединяем все тексты в один
      const combinedText = texts
        .filter((text) => text && typeof text === "string")
        .join(" ")
        .trim();

      if (!combinedText) {
        return `item-${Date.now()}`;
      }

      return this.createBaseSlug(combinedText);
    } catch (error) {
      logError(error, "SlugService.generateSlugFromMultipleSources");
      return `item-${Date.now()}`;
    }
  }

  // Статистика использования slug
  async getSlugStatistics() {
    try {
      const questionSlugs = await Question.countDocuments();
      const categorySlugs = await Category.countDocuments();

      // Анализ длины slug
      const slugLengthStats = await Question.aggregate([
        {
          $project: {
            slugLength: { $strLenCP: "$slug" },
          },
        },
        {
          $group: {
            _id: null,
            avgLength: { $avg: "$slugLength" },
            minLength: { $min: "$slugLength" },
            maxLength: { $max: "$slugLength" },
          },
        },
      ]);

      return {
        totalQuestionSlugs: questionSlugs,
        totalCategorySlugs: categorySlugs,
        slugLengthStats: slugLengthStats[0] || {
          avgLength: 0,
          minLength: 0,
          maxLength: 0,
        },
      };
    } catch (error) {
      logError(error, "SlugService.getSlugStatistics");
      throw error;
    }
  }
}

export default new SlugService();
