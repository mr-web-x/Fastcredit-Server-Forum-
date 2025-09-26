// Роли пользователей
export const USER_ROLES = {
  USER: "user",
  EXPERT: "expert",
  ADMIN: "admin",
};

// Social media
export const SOCIAL_PLATFORMS = {
  FACEBOOK: "facebook",
  LINKEDIN: "linkedin",
};

// Social actions
export const ANSWER_ACTIONS = {
  CREATE: "create", // Створення відповіді
  UPDATE: "update", // Редагування змісту
  APPROVE: "approve", // Схвалення
  REJECT: "reject", // Відхилення
  SOCIAL_PUBLISH: "social_publish", // Публікація в соцмережі
  SOCIAL_DELETE: "social_delete", // Видалення з соцмережі
};

// Статусы вопросов
export const QUESTION_STATUS = {
  PENDING: "pending",
  ANSWERED: "answered",
  CLOSED: "closed",
};

// Приоритеты вопросов
export const QUESTION_PRIORITY = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};

// Типы объектов для лайков
export const LIKE_TARGET_TYPES = {
  QUESTION: "question",
  ANSWER: "answer",
  COMMENT: "comment",
};

// Типы действий для rate limiting
export const RATE_LIMIT_ACTIONS = {
  QUESTION_CREATE: "question_create",
  ANSWER_CREATE: "answer_create",
  COMMENT_CREATE: "comment_create",
  LIKE: "like",
  LOGIN_ATTEMPT: "login_attempt",
};

// Типы объектов для жалоб
export const REPORT_TARGET_TYPES = {
  QUESTION: "question",
  ANSWER: "answer",
  COMMENT: "comment",
};

// Причины жалоб
export const REPORT_REASONS = {
  SPAM: "spam",
  INAPPROPRIATE: "inappropriate",
  OFFENSIVE: "offensive",
  OTHER: "other",
};

// Статусы жалоб
export const REPORT_STATUS = {
  PENDING: "pending",
  REVIEWED: "reviewed",
  RESOLVED: "resolved",
};

// Категории (заготовка)
export const DEFAULT_CATEGORIES = {
  GENERAL: "general",
  LOANS: "loans",
  CREDIT: "credit",
  BANKING: "banking",
  INSURANCE: "insurance",
};

// HTTP статус коды для логирования
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
};

// Статусы для логирования
export const LOG_STATUS = {
  SUCCESS: "SUCCESS",
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
};

// Типы безопасности для логирования
export const SECURITY_EVENT_TYPES = {
  UNAUTHORIZED_ACCESS: "UNAUTHORIZED_ACCESS",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  INVALID_TOKEN: "INVALID_TOKEN",
  BANNED_USER_ATTEMPT: "BANNED_USER_ATTEMPT",
  SPAM_DETECTED: "SPAM_DETECTED",
  ROLE_ESCALATION_ATTEMPT: "ROLE_ESCALATION_ATTEMPT",
};

// Регулярные выражения для валидации
export const REGEX_PATTERNS = {
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  SLUG: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  PHONE: /^\+?[1-9]\d{1,14}$/,
};

// Лимиты контента
export const CONTENT_LIMITS = {
  QUESTION_TITLE_MIN: 10,
  QUESTION_TITLE_MAX: 200,
  QUESTION_CONTENT_MIN: 20,
  QUESTION_CONTENT_MAX: 5000,
  ANSWER_CONTENT_MIN: 50,
  ANSWER_CONTENT_MAX: 10000,
  COMMENT_CONTENT_MIN: 5,
  COMMENT_CONTENT_MAX: 1000,
  BIO_MAX: 500,
};
// Chybové správy
export const ERROR_MESSAGES = {
  // Auth
  UNAUTHORIZED: "Vyžaduje sa autorizácia",
  FORBIDDEN: "Nedostatočné oprávnenia",
  INVALID_TOKEN: "Neplatný token",
  USER_BANNED: "Používateľ je zablokovaný",

  // Validation
  VALIDATION_ERROR: "Chyba validácie údajov",
  REQUIRED_FIELD: "Povinné pole",
  INVALID_FORMAT: "Nesprávny formát údajov",

  // Rate Limiting
  RATE_LIMIT_EXCEEDED: "Prekročený limit požiadaviek. Skúste neskôr",

  // Not Found
  USER_NOT_FOUND: "Používateľ nenájdený",
  QUESTION_NOT_FOUND: "Otázka nenájdená",
  ANSWER_NOT_FOUND: "Odpoveď nenájdená",
  COMMENT_NOT_FOUND: "Komentár nenájdený",

  // Business Logic
  QUESTION_ALREADY_ANSWERED: "Otázka už bola zodpovedaná",
  CANNOT_ANSWER_OWN_QUESTION: "Nemôžete odpovedať na vlastnú otázku",
  ANSWER_ALREADY_ACCEPTED: "Odpoveď už bola prijatá",
  ALREADY_LIKED: "Už ste dali like",

  // Server
  INTERNAL_SERVER_ERROR: "Interná chyba servera",
  DATABASE_ERROR: "Chyba databázy",
};

// Správy o úspechu
export const SUCCESS_MESSAGES = {
  QUESTION_CREATED: "Otázka bola úspešne vytvorená",
  ANSWER_CREATED: "Odpoveď bola úspešne vytvorená",
  COMMENT_CREATED: "Komentár bol úspešne vytvorený",
  LIKE_ADDED: "Like bol pridaný",
  LIKE_REMOVED: "Like bol odstránený",
  ROLE_CHANGED: "Rola používateľa bola zmenená",
  USER_BANNED: "Používateľ bol zablokovaný",
  USER_UNBANNED: "Používateľ bol odblokovaný",
  CONTENT_APPROVED: "Obsah bol schválený",
  CONTENT_REJECTED: "Obsah bol zamietnutý",
};

export default {
  USER_ROLES,
  QUESTION_STATUS,
  QUESTION_PRIORITY,
  LIKE_TARGET_TYPES,
  RATE_LIMIT_ACTIONS,
  REPORT_TARGET_TYPES,
  REPORT_REASONS,
  REPORT_STATUS,
  DEFAULT_CATEGORIES,
  HTTP_STATUS,
  LOG_STATUS,
  SECURITY_EVENT_TYPES,
  REGEX_PATTERNS,
  CONTENT_LIMITS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
};
