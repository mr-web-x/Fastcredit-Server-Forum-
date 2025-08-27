// middlewares/validation.js
import { body, param, query, validationResult } from "express-validator";
import { CONTENT_LIMITS, ERROR_MESSAGES } from "../utils/constants.js";
import { formatResponse } from "../utils/helpers.js";
import { logError } from "./logger.js";

// Middleware для обработки результатов валидации
export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const errorArray = errors.array();

    // Логируем ошибки валидации
    logError(
      new Error(
        `Validation failed: ${errorArray.map((e) => e.msg).join(", ")}`
      ),
      "Validation",
      req.user?.id
    );

    return res.status(400).json(
      formatResponse(false, null, ERROR_MESSAGES.VALIDATION_ERROR, {
        type: "ValidationError",
        details: errorArray.map((error) => ({
          field: error.path || error.param,
          message: error.msg,
          value: error.value,
        })),
      })
    );
  }

  next();
};

// Валидация для создания вопроса
export const validateQuestionCreate = [
  body("title")
    .trim()
    .isLength({
      min: CONTENT_LIMITS.QUESTION_TITLE_MIN,
      max: CONTENT_LIMITS.QUESTION_TITLE_MAX,
    })
    .withMessage(
      `Заголовок должен быть от ${CONTENT_LIMITS.QUESTION_TITLE_MIN} до ${CONTENT_LIMITS.QUESTION_TITLE_MAX} символов`
    )
    .escape(),

  body("content")
    .trim()
    .isLength({
      min: CONTENT_LIMITS.QUESTION_CONTENT_MIN,
      max: CONTENT_LIMITS.QUESTION_CONTENT_MAX,
    })
    .withMessage(
      `Содержание должно быть от ${CONTENT_LIMITS.QUESTION_CONTENT_MIN} до ${CONTENT_LIMITS.QUESTION_CONTENT_MAX} символов`
    )
    .escape(),

  body("category")
    .optional()
    .trim()
    .isAlphanumeric("en-US", { ignore: "_-" })
    .withMessage(
      "Категория может содержать только буквы, цифры, дефисы и подчеркивания"
    )
    .escape(),

  handleValidationErrors,
];

// Валидация для обновления вопроса
export const validateQuestionUpdate = [
  param("id").isMongoId().withMessage("Неверный ID вопроса"),

  body("title")
    .optional()
    .trim()
    .isLength({
      min: CONTENT_LIMITS.QUESTION_TITLE_MIN,
      max: CONTENT_LIMITS.QUESTION_TITLE_MAX,
    })
    .withMessage(
      `Заголовок должен быть от ${CONTENT_LIMITS.QUESTION_TITLE_MIN} до ${CONTENT_LIMITS.QUESTION_TITLE_MAX} символов`
    )
    .escape(),

  body("content")
    .optional()
    .trim()
    .isLength({
      min: CONTENT_LIMITS.QUESTION_CONTENT_MIN,
      max: CONTENT_LIMITS.QUESTION_CONTENT_MAX,
    })
    .withMessage(
      `Содержание должно быть от ${CONTENT_LIMITS.QUESTION_CONTENT_MIN} до ${CONTENT_LIMITS.QUESTION_CONTENT_MAX} символов`
    )
    .escape(),

  handleValidationErrors,
];

// Валидация для создания ответа
export const validateAnswerCreate = [
  param("questionId").isMongoId().withMessage("Неверный ID вопроса"),

  body("content")
    .trim()
    .isLength({
      min: CONTENT_LIMITS.ANSWER_CONTENT_MIN,
      max: CONTENT_LIMITS.ANSWER_CONTENT_MAX,
    })
    .withMessage(
      `Ответ должен быть от ${CONTENT_LIMITS.ANSWER_CONTENT_MIN} до ${CONTENT_LIMITS.ANSWER_CONTENT_MAX} символов`
    )
    .escape(),

  handleValidationErrors,
];

// Валидация для создания комментария
export const validateCommentCreate = [
  param("questionId").isMongoId().withMessage("Неверный ID вопроса"),

  body("content")
    .trim()
    .isLength({
      min: CONTENT_LIMITS.COMMENT_CONTENT_MIN,
      max: CONTENT_LIMITS.COMMENT_CONTENT_MAX,
    })
    .withMessage(
      `Комментарий должен быть от ${CONTENT_LIMITS.COMMENT_CONTENT_MIN} до ${CONTENT_LIMITS.COMMENT_CONTENT_MAX} символов`
    )
    .escape(),

  body("parentComment")
    .optional()
    .isMongoId()
    .withMessage("Неверный ID родительского комментария"),

  handleValidationErrors,
];

// Валидация для обновления профиля
export const validateProfileUpdate = [
  body("bio")
    .optional()
    .trim()
    .isLength({ max: CONTENT_LIMITS.BIO_MAX })
    .withMessage(
      `Биография не может превышать ${CONTENT_LIMITS.BIO_MAX} символов`
    )
    .escape(),

  body("avatar")
    .optional()
    .isURL()
    .withMessage("Неверный формат URL для аватара"),

  handleValidationErrors,
];

// Валидация для изменения роли пользователя (админ)
export const validateRoleChange = [
  param("id").isMongoId().withMessage("Неверный ID пользователя"),

  body("role")
    .isIn(["user", "expert", "admin"])
    .withMessage("Роль должна быть: user, expert или admin"),

  body("reason")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Причина не может превышать 500 символов")
    .escape(),

  handleValidationErrors,
];

// Валидация для бана пользователя
export const validateUserBan = [
  param("id").isMongoId().withMessage("Неверный ID пользователя"),

  body("reason")
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage("Причина бана должна быть от 10 до 500 символов")
    .escape(),

  body("duration")
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage("Длительность бана должна быть от 1 до 365 дней"),

  handleValidationErrors,
];

// Валидация для создания жалобы
export const validateReportCreate = [
  body("targetId").isMongoId().withMessage("Неверный ID объекта жалобы"),

  body("targetType")
    .isIn(["question", "answer", "comment"])
    .withMessage("Тип объекта должен быть: question, answer или comment"),

  body("reason")
    .isIn(["spam", "inappropriate", "offensive", "other"])
    .withMessage(
      "Причина должна быть: spam, inappropriate, offensive или other"
    ),

  body("description")
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("Описание не может превышать 1000 символов")
    .escape(),

  handleValidationErrors,
];

// Валидация для поиска
export const validateSearch = [
  query("q")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("Поисковый запрос должен быть от 2 до 100 символов")
    .escape(),

  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Номер страницы должен быть положительным числом"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage("Лимит результатов должен быть от 1 до 50"),

  handleValidationErrors,
];

// Валидация для пагинации
export const validatePagination = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Номер страницы должен быть положительным числом"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage("Лимит результатов должен быть от 1 до 50"),

  handleValidationErrors,
];

// Валидация MongoDB ObjectId параметра
export const validateObjectId = (paramName = "id") => [
  param(paramName).isMongoId().withMessage(`Неверный ${paramName}`),

  handleValidationErrors,
];

export default {
  handleValidationErrors,
  validateQuestionCreate,
  validateQuestionUpdate,
  validateAnswerCreate,
  validateCommentCreate,
  validateProfileUpdate,
  validateRoleChange,
  validateUserBan,
  validateReportCreate,
  validateSearch,
  validatePagination,
  validateObjectId,
};
