// middlewares/spamProtection.js
import { formatResponse, getClientIP } from "../utils/helpers.js";
import { logSecurityEvent } from "./logger.js";

// Список подозрительных слов (можно расширить)
const spamKeywords = [
  // Общий спам
  "viagra",
  "casino",
  "lottery",
  "winner",
  "congratulations",
  "free money",
  "make money fast",
  "get rich quick",
  "click here",
  "limited time",
  "act now",
  "urgent",
  "100% free",
  "no cost",

  // Ссылки и реклама
  "buy now",
  "discount",
  "offer expires",
  "special promotion",
  "earn money",
  "work from home",
  "business opportunity",

  // Подозрительные символы и паттерны
  "₿",
  "💰",
  "🚀",
  "📈",
  "💎",
  "🔥",
];

// Паттерны для проверки ссылок
const linkPatterns = [
  /https?:\/\/[^\s]+/gi,
  /www\.[^\s]+/gi,
  /[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}/gi,
];

// Паттерны подозрительного контента
const suspiciousPatterns = [
  /(.)\1{4,}/g, // повторяющиеся символы (aaaaa, !!!!!!)
  /[A-Z]{5,}/g, // много заглавных букв подряд
  /\d{10,}/g, // длинные числа (телефоны и т.д.)
  /[!@#$%^&*]{3,}/g, // много спецсимволов подряд
];

// Проверка на спам-ключевые слова
const containsSpamKeywords = (text) => {
  const lowerText = text.toLowerCase();
  return spamKeywords.some((keyword) => lowerText.includes(keyword));
};

// Подсчет ссылок в тексте
const countLinks = (text) => {
  let linkCount = 0;
  linkPatterns.forEach((pattern) => {
    const matches = text.match(pattern);
    if (matches) linkCount += matches.length;
  });
  return linkCount;
};

// Проверка на подозрительные паттерны
const hasSuspiciousPatterns = (text) => {
  return suspiciousPatterns.some((pattern) => pattern.test(text));
};

// Вычисление спам-скора
const calculateSpamScore = (text, title = "") => {
  let score = 0;
  const combinedText = `${title} ${text}`.toLowerCase();

  // Проверка ключевых слов (+20 за каждое)
  const keywordMatches = spamKeywords.filter((keyword) =>
    combinedText.includes(keyword)
  );
  score += keywordMatches.length * 20;

  // Проверка ссылок (+15 за каждую, но первая ссылка +5)
  const linkCount = countLinks(combinedText);
  if (linkCount > 0) {
    score += 5 + (linkCount - 1) * 15;
  }

  // Проверка подозрительных паттернов (+10 за каждый)
  const suspiciousCount = suspiciousPatterns.filter((pattern) =>
    pattern.test(combinedText)
  ).length;
  score += suspiciousCount * 10;

  // Проверка соотношения заглавных/строчных букв
  const upperCaseCount = (combinedText.match(/[A-Z]/g) || []).length;
  const totalLetters = (combinedText.match(/[a-zA-Z]/g) || []).length;
  if (totalLetters > 10 && upperCaseCount / totalLetters > 0.7) {
    score += 15; // много заглавных букв
  }

  // Проверка длины текста vs количество ссылок
  if (text.length < 100 && linkCount > 0) {
    score += 10; // короткий текст с ссылками подозрителен
  }

  // Проверка повторяющихся символов
  const repeatingChars = text.match(/(.)\1{3,}/g);
  if (repeatingChars && repeatingChars.length > 2) {
    score += 15;
  }

  return score;
};

// Основной middleware для проверки спама
export const checkSpam = (options = {}) => {
  const {
    threshold = 30, // порог спам-скора
    checkTitle = true, // проверять ли заголовок
    checkContent = true, // проверять ли контент
    allowForExperts = true, // разрешить экспертам больше свободы
    blockHighScore = 80, // блокировать при высоком скоре
  } = options;

  return (req, res, next) => {
    try {
      let textToCheck = "";
      let titleToCheck = "";

      // Собираем текст для проверки
      if (checkTitle && req.body.title) {
        titleToCheck = req.body.title;
        textToCheck += titleToCheck;
      }

      if (checkContent && req.body.content) {
        textToCheck += " " + req.body.content;
      }

      // Если нет текста для проверки, пропускаем
      if (!textToCheck.trim()) {
        return next();
      }

      // Вычисляем спам-скор
      const spamScore = calculateSpamScore(textToCheck, titleToCheck);

      // Определяем порог в зависимости от роли пользователя
      let effectiveThreshold = threshold;
      if (allowForExperts && req.user && req.user.isExpert) {
        effectiveThreshold = threshold + 20; // эксперты имеют больше свободы
      }

      // Добавляем информацию о спам-скоре в запрос
      req.spamScore = spamScore;
      req.spamInfo = {
        score: spamScore,
        threshold: effectiveThreshold,
        isSpam: spamScore >= effectiveThreshold,
        isHighRisk: spamScore >= blockHighScore,
      };

      // Логируем подозрительный контент
      if (spamScore >= threshold / 2) {
        logSecurityEvent(
          "SPAM_DETECTED",
          `Potential spam detected: score ${spamScore}, text: "${textToCheck.substring(
            0,
            100
          )}..."`,
          req.user?._id,
          getClientIP(req)
        );
      }

      // Блокируем очень подозрительный контент
      if (spamScore >= blockHighScore) {
        logSecurityEvent(
          "HIGH_SPAM_BLOCKED",
          `High spam score blocked: ${spamScore}, user: ${req.user?._id}`,
          req.user?._id,
          getClientIP(req)
        );

        return res.status(400).json(
          formatResponse(
            false,
            null,
            "Контент заблокирован системой защиты от спама",
            {
              type: "SPAM_BLOCKED",
              spamScore: spamScore,
              reasons:
                spamScore >= 80 ? ["High spam score"] : ["Suspicious content"],
            }
          )
        );
      }

      // Предупреждаем о подозрительном контенте
      if (spamScore >= effectiveThreshold) {
        logSecurityEvent(
          "SPAM_WARNING",
          `Spam warning: score ${spamScore}, proceeding with caution`,
          req.user?._id,
          getClientIP(req)
        );

        // Можно добавить флаг для дополнительной модерации
        req.needsModeration = true;
      }

      next();
    } catch (error) {
      console.error("Spam protection error:", error);
      // При ошибке пропускаем проверку
      next();
    }
  };
};

// Middleware для проверки дублирования контента
export const checkDuplicateContent = (Model, field = "content") => {
  return async (req, res, next) => {
    try {
      if (!req.body[field]) {
        return next();
      }

      const contentHash = Buffer.from(req.body[field]).toString("base64");

      // Проверяем последние записи пользователя (если авторизован)
      if (req.user) {
        const recentContent = await Model.find({
          author: req.user._id,
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // последние 24 часа
        }).limit(10);

        const isDuplicate = recentContent.some((item) => {
          const itemHash = Buffer.from(item[field]).toString("base64");
          return itemHash === contentHash;
        });

        if (isDuplicate) {
          logSecurityEvent(
            "DUPLICATE_CONTENT_BLOCKED",
            `Duplicate content blocked for user ${req.user._id}`,
            req.user._id,
            getClientIP(req)
          );

          return res.status(400).json(
            formatResponse(
              false,
              null,
              "Обнаружен дублированный контент. Попробуйте изменить текст.",
              {
                type: "DUPLICATE_CONTENT",
                message:
                  "Вы уже публиковали похожий контент в течение последних 24 часов",
              }
            )
          );
        }
      }

      next();
    } catch (error) {
      console.error("Duplicate content check error:", error);
      // При ошибке пропускаем проверку
      next();
    }
  };
};

// Middleware для проверки частоты публикаций
export const checkPostingFrequency = (windowMs = 60000, maxPosts = 3) => {
  const userPosts = new Map(); // временное хранилище в памяти

  return (req, res, next) => {
    if (!req.user) {
      return next();
    }

    const userId = req.user._id.toString();
    const now = Date.now();

    // Получаем историю постов пользователя
    if (!userPosts.has(userId)) {
      userPosts.set(userId, []);
    }

    const posts = userPosts.get(userId);

    // Удаляем старые записи
    const recentPosts = posts.filter((timestamp) => now - timestamp < windowMs);

    if (recentPosts.length >= maxPosts) {
      logSecurityEvent(
        "POSTING_FREQUENCY_LIMITED",
        `Posting frequency limit exceeded: ${recentPosts.length}/${maxPosts} in ${windowMs}ms`,
        req.user._id,
        getClientIP(req)
      );

      return res.status(429).json(
        formatResponse(
          false,
          null,
          `Слишком частые публикации. Максимум ${maxPosts} публикаций в минуту.`,
          {
            type: "POSTING_FREQUENCY_LIMITED",
            current: recentPosts.length,
            max: maxPosts,
            resetAfter: Math.ceil((recentPosts[0] + windowMs - now) / 1000),
          }
        )
      );
    }

    // Добавляем текущий пост
    recentPosts.push(now);
    userPosts.set(userId, recentPosts);

    next();
  };
};

export default {
  checkSpam,
  checkDuplicateContent,
  checkPostingFrequency,
};
