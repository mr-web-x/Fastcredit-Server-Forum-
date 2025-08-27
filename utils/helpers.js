// utils/helpers.js
import slugify from "slugify";

// Генерация slug из текста
export const generateSlug = (text, options = {}) => {
  const defaultOptions = {
    lower: true,
    strict: true,
    locale: "en",
    trim: true,
  };

  return slugify(text, { ...defaultOptions, ...options });
};

// Генерация уникального slug для вопроса
export const generateUniqueSlug = async (title, Model) => {
  let baseSlug = generateSlug(title);
  let slug = baseSlug;
  let counter = 1;

  while (await Model.findOne({ slug })) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
};

// Форматирование ответа API
export const formatResponse = (
  success = true,
  data = null,
  message = null,
  error = null
) => {
  const response = { success };

  if (data !== null) response.data = data;
  if (message) response.message = message;
  if (error) response.error = error;

  return response;
};

// Пагинация
export const getPaginationData = (req) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

// Создание объекта пагинации для ответа
export const createPaginationResponse = (data, total, page, limit) => {
  const totalPages = Math.ceil(total / limit);

  return {
    data,
    pagination: {
      current: page,
      total: totalPages,
      count: data.length,
      totalItems: total,
      hasNext: page < totalPages,
      hasPrev: page > 1,
      next: page < totalPages ? page + 1 : null,
      prev: page > 1 ? page - 1 : null,
    },
  };
};

// Очистка объекта от null/undefined значений
export const cleanObject = (obj) => {
  const cleaned = {};

  Object.keys(obj).forEach((key) => {
    if (obj[key] !== null && obj[key] !== undefined && obj[key] !== "") {
      cleaned[key] = obj[key];
    }
  });

  return cleaned;
};

// Извлечение IP адреса из запроса
export const getClientIP = (req) => {
  return (
    req.ip ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    (req.headers["x-forwarded-for"] &&
      req.headers["x-forwarded-for"].split(",")[0]) ||
    req.headers["x-real-ip"] ||
    "unknown"
  ).replace(/^::ffff:/, "");
};

// Валидация ObjectId
export const isValidObjectId = (id) => {
  return /^[0-9a-fA-F]{24}$/.test(id);
};

// Генерация случайного кода
export const generateRandomCode = (length = 6) => {
  const characters = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let result = "";

  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  return result;
};

// Задержка (для rate limiting)
export const delay = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

// Форматирование даты для отображения
export const formatDate = (date, locale = "sk-SK") => {
  return new Date(date).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// Подсчет времени чтения текста
export const calculateReadingTime = (text, wordsPerMinute = 200) => {
  const wordCount = text.split(/\s+/).length;
  const minutes = Math.ceil(wordCount / wordsPerMinute);
  return Math.max(1, minutes);
};

// Обрезка текста с сохранением слов
export const truncateText = (text, maxLength) => {
  if (text.length <= maxLength) return text;

  const truncated = text.substr(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");

  return truncated.substr(0, lastSpace) + "...";
};

// Экранирование HTML
export const escapeHtml = (text) => {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };

  return text.replace(/[&<>"']/g, (m) => map[m]);
};

// Создание хэша для кэширования
export const createHash = (data) => {
  return Buffer.from(JSON.stringify(data)).toString("base64");
};

export default {
  generateSlug,
  generateUniqueSlug,
  formatResponse,
  getPaginationData,
  createPaginationResponse,
  cleanObject,
  getClientIP,
  isValidObjectId,
  generateRandomCode,
  delay,
  formatDate,
  calculateReadingTime,
  truncateText,
  escapeHtml,
  createHash,
};
