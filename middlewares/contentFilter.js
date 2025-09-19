// middlewares/contentFilter.js
import { formatResponse, escapeHtml } from "../utils/helpers.js";
import { logSecurityEvent } from "./logger.js";

// Список запрещенных слов (можно расширить и вынести в конфиг)
const bannedWords = [
  // Мат и оскорбления (примеры)
  "дурак",
  "идиот",
  "кретин",
  "дебил",
  "урод",
  // Дискриминация
  "расист",
  "фашист",
  "нацист",
  // Угрозы
  "убить",
  "убью",
  "смерть",
  "умри",
  // Добавить другие по необходимости
];

// Паттерны для обхода фильтров (замена символов)
const obfuscationPatterns = [
  { pattern: /[0о]/gi, replacement: "о" },
  { pattern: /[3з]/gi, replacement: "з" },
  { pattern: /[1l|]/gi, replacement: "l" },
  { pattern: /[4а@]/gi, replacement: "а" },
  { pattern: /[5s$]/gi, replacement: "s" },
  { pattern: /[6б]/gi, replacement: "б" },
  { pattern: /[7т]/gi, replacement: "т" },
  { pattern: /[8в]/gi, replacement: "в" },
];

// HTML теги и атрибуты, которые нужно удалить
const dangerousHtmlPatterns = [
  /<script[^>]*>[\s\S]*?<\/script>/gi,
  /<iframe[^>]*>[\s\S]*?<\/iframe>/gi,
  /<object[^>]*>[\s\S]*?<\/object>/gi,
  /<embed[^>]*>/gi,
  /<link[^>]*>/gi,
  /<meta[^>]*>/gi,
  /<style[^>]*>[\s\S]*?<\/style>/gi,
  /on\w+\s*=\s*["'][^"']*["']/gi, // события вроде onclick
  /javascript:/gi,
  /vbscript:/gi,
  /data:/gi,
];

// Проверка на запрещенные слова
const containsBannedWords = (text) => {
  const cleanText = deobfuscateText(text.toLowerCase());
  const foundWords = bannedWords.filter((word) =>
    cleanText.includes(word.toLowerCase())
  );
  return foundWords;
};

// Деобфускация текста (восстановление замененных символов)
const deobfuscateText = (text) => {
  let cleanText = text;
  obfuscationPatterns.forEach(({ pattern, replacement }) => {
    cleanText = cleanText.replace(pattern, replacement);
  });
  return cleanText;
};

// Удаление опасного HTML
const sanitizeHtmlContent = (text) => {
  let cleanText = text;

  // Удаляем опасные теги и атрибуты
  dangerousHtmlPatterns.forEach((pattern) => {
    cleanText = cleanText.replace(pattern, "");
  });

  // Экранируем оставшийся HTML
  cleanText = escapeHtml(cleanText);

  return cleanText;
};

// Проверка на чрезмерное использование заглавных букв
const hasExcessiveCapitals = (text, threshold = 0.7) => {
  const letters = text.match(/[a-zA-Zа-яёА-ЯЁ]/g);
  if (!letters || letters.length < 10) return false;

  const capitals = text.match(/[A-ZА-ЯЁ]/g);
  if (!capitals) return false;

  return capitals.length / letters.length > threshold;
};

// Проверка на избыточную пунктуацию
const hasExcessivePunctuation = (text) => {
  const punctuationPatterns = [
    /[!]{3,}/g, // много восклицательных знаков
    /[?]{3,}/g, // много вопросительных знаков
    /[.]{4,}/g, // много точек
    /[,]{3,}/g, // много запятых
    /[-]{4,}/g, // много тире
  ];

  return punctuationPatterns.some((pattern) => pattern.test(text));
};

// Основной middleware для фильтрации контента
export const filterContent = (options = {}) => {
  const {
    checkBannedWords = true,
    sanitizeHtml = true,
    checkCapitals = true,
    checkPunctuation = true,
    strictMode = false, // строгий режим для новых пользователей
  } = options;

  return (req, res, next) => {
    try {
      const issues = [];
      const fieldsToCheck = ["title", "content", "bio", "description"];

      fieldsToCheck.forEach((field) => {
        if (req.body[field]) {
          let text = req.body[field];
          const originalText = text;

          // Проверка на запрещенные слова
          if (checkBannedWords) {
            const foundBannedWords = containsBannedWords(text);
            if (foundBannedWords.length > 0) {
              issues.push({
                field,
                type: "BANNED_WORDS",
                words: foundBannedWords,
                severity: "high",
              });

              // В строгом режиме блокируем сразу
              if (strictMode) {
                logSecurityEvent(
                  "BANNED_WORDS_BLOCKED",
                  `Banned words found in ${field}: ${foundBannedWords.join(
                    ", "
                  )}`,
                  req.user?._id,
                  req.ip
                );

                return res.status(400).json(
                  formatResponse(
                    false,
                    null,
                    `Обнаружены недопустимые слова в поле "${field}"`,
                    {
                      type: "CONTENT_BLOCKED",
                      field,
                      reason: "Banned words detected",
                      words: foundBannedWords,
                    }
                  )
                );
              }
            }
          }

          // Санитизация HTML
          if (sanitizeHtml) {
            text = sanitizeHtmlContent(text);
            if (text !== originalText) {
              issues.push({
                field,
                type: "HTML_SANITIZED",
                severity: "medium",
              });
            }
          }

          // Проверка заглавных букв
          if (checkCapitals && hasExcessiveCapitals(text)) {
            issues.push({
              field,
              type: "EXCESSIVE_CAPITALS",
              severity: "low",
            });
          }

          // Проверка пунктуации
          if (checkPunctuation && hasExcessivePunctuation(text)) {
            issues.push({
              field,
              type: "EXCESSIVE_PUNCTUATION",
              severity: "low",
            });
          }

          // Обновляем поле очищенным текстом
          req.body[field] = text.trim();
        }
      });

      // Добавляем информацию о проблемах в запрос
      req.contentIssues = issues;

      // Логируем серьезные проблемы
      const highSeverityIssues = issues.filter(
        (issue) => issue.severity === "high"
      );
      if (highSeverityIssues.length > 0) {
        logSecurityEvent(
          "CONTENT_ISSUES_DETECTED",
          `High severity content issues: ${JSON.stringify(highSeverityIssues)}`,
          req.user?._id,
          req.ip
        );

        // В обычном режиме помечаем для дополнительной модерации
        req.needsModeration = true;
      }

      next();
    } catch (error) {
      console.error("Content filter error:", error);
      // При ошибке пропускаем фильтрацию
      next();
    }
  };
};

// Middleware для проверки длины контента
export const checkContentLength = (options = {}) => {
  return (req, res, next) => {
    const checks = {
      title: { min: 10, max: 200, ...options.title },
      content: { min: 20, max: 5000, ...options.content },
      bio: { min: 0, max: 500, ...options.bio },
      comment: { min: 5, max: 1000, ...options.comment },
    };

    for (const [field, limits] of Object.entries(checks)) {
      if (req.body[field]) {
        const text = req.body[field].trim();

        if (text.length < limits.min) {
          return res.status(400).json(
            formatResponse(
              false,
              null,
              `Поле "${field}" слишком короткое. Минимум ${limits.min} символов.`,
              {
                type: "CONTENT_TOO_SHORT",
                field,
                current: text.length,
                minimum: limits.min,
              }
            )
          );
        }

        if (text.length > limits.max) {
          return res.status(400).json(
            formatResponse(
              false,
              null,
              `Поле "${field}" слишком длинное. Максимум ${limits.max} символов.`,
              {
                type: "CONTENT_TOO_LONG",
                field,
                current: text.length,
                maximum: limits.max,
              }
            )
          );
        }
      }
    }

    next();
  };
};

// Middleware для проверки контента на наличие ссылок
export const checkLinks = (options = {}) => {
  const {
    maxLinks = 2,
    allowedDomains = [],
    requirePermission = false,
  } = options;

  return (req, res, next) => {
    const fieldsToCheck = ["title", "content", "bio"];

    for (const field of fieldsToCheck) {
      if (req.body[field]) {
        const text = req.body[field];
        const links = text.match(/https?:\/\/[^\s]+/gi) || [];

        if (links.length > maxLinks) {
          return res.status(400).json(
            formatResponse(
              false,
              null,
              `Слишком много ссылок в поле "${field}". Максимум ${maxLinks}.`,
              {
                type: "TOO_MANY_LINKS",
                field,
                current: links.length,
                maximum: maxLinks,
                links,
              }
            )
          );
        }

        // Проверка разрешенных доменов
        if (allowedDomains.length > 0) {
          const unauthorizedLinks = links.filter((link) => {
            try {
              const url = new URL(link);
              return !allowedDomains.some((domain) =>
                url.hostname.includes(domain)
              );
            } catch {
              return true; // неверный URL считаем недопустимым
            }
          });

          if (unauthorizedLinks.length > 0) {
            return res.status(400).json(
              formatResponse(
                false,
                null,
                `Недопустимые ссылки в поле "${field}". Разрешены только ссылки на: ${allowedDomains.join(
                  ", "
                )}`,
                {
                  type: "UNAUTHORIZED_LINKS",
                  field,
                  unauthorizedLinks,
                  allowedDomains,
                }
              )
            );
          }
        }

        // Требование разрешения для новых пользователей
        if (requirePermission && links.length > 0 && req.user) {
          const isNewUser =
            Date.now() - req.user.createdAt.getTime() < 7 * 24 * 60 * 60 * 1000; // неделя

          if (isNewUser && !req.user.isExpert) {
            req.needsModeration = true;
            logSecurityEvent(
              "NEW_USER_WITH_LINKS",
              `New user posted content with links: ${links.join(", ")}`,
              req.user._id,
              req.ip
            );
          }
        }
      }
    }

    next();
  };
};

export default {
  filterContent,
  checkContentLength,
  checkLinks,
};
