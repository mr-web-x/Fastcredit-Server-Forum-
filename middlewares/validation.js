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
      formatResponse(false, null, "Chyba validácie", {
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
      `Názov musí mať od ${CONTENT_LIMITS.QUESTION_TITLE_MIN} do ${CONTENT_LIMITS.QUESTION_TITLE_MAX} znakov`
    )
    .escape(),

  body("content")
    .trim()
    .isLength({
      min: CONTENT_LIMITS.QUESTION_CONTENT_MIN,
      max: CONTENT_LIMITS.QUESTION_CONTENT_MAX,
    })
    .withMessage(
      `Obsah musí mať od ${CONTENT_LIMITS.QUESTION_CONTENT_MIN} do ${CONTENT_LIMITS.QUESTION_CONTENT_MAX} znakov`
    )
    .escape(),

  body("category")
    .optional()
    .trim()
    .isAlphanumeric("en-US", { ignore: "_-" })
    .withMessage(
      "Kategória môže obsahovať iba písmená, čísla, pomlčky a podčiarknutia"
    )
    .escape(),

  handleValidationErrors,
];

// Валидация для обновления вопроса
export const validateQuestionUpdate = [
  param("id").isMongoId().withMessage("Neplatné ID otázky"),

  body("title")
    .optional()
    .trim()
    .isLength({
      min: CONTENT_LIMITS.QUESTION_TITLE_MIN,
      max: CONTENT_LIMITS.QUESTION_TITLE_MAX,
    })
    .withMessage(
      `Názov musí mať od ${CONTENT_LIMITS.QUESTION_TITLE_MIN} do ${CONTENT_LIMITS.QUESTION_TITLE_MAX} znakov`
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
      `Obsah musí mať od ${CONTENT_LIMITS.QUESTION_CONTENT_MIN} do ${CONTENT_LIMITS.QUESTION_CONTENT_MAX} znakov`
    )
    .escape(),

  handleValidationErrors,
];

// Валидация для создания ответа
export const validateAnswerCreate = [
  param("questionId").isMongoId().withMessage("Neplatné ID otázky"),

  body("content")
    .trim()
    .isLength({
      min: CONTENT_LIMITS.ANSWER_CONTENT_MIN,
      max: CONTENT_LIMITS.ANSWER_CONTENT_MAX,
    })
    .withMessage(
      `Odpoveď musí mať od ${CONTENT_LIMITS.ANSWER_CONTENT_MIN} do ${CONTENT_LIMITS.ANSWER_CONTENT_MAX} znakov`
    )
    .escape(),

  handleValidationErrors,
];

// Валидация для создания комментария
export const validateCommentCreate = [
  param("questionId").isMongoId().withMessage("Neplatné ID otázky"),

  body("content")
    .trim()
    .isLength({
      min: CONTENT_LIMITS.COMMENT_CONTENT_MIN,
      max: CONTENT_LIMITS.COMMENT_CONTENT_MAX,
    })
    .withMessage(
      `Komentár musí mať od ${CONTENT_LIMITS.COMMENT_CONTENT_MIN} do ${CONTENT_LIMITS.COMMENT_CONTENT_MAX} znakov`
    )
    .escape(),

  body("parentComment")
    .optional()
    .isMongoId()
    .withMessage("Neplatné ID rodičovského komentára"),

  handleValidationErrors,
];

// Валидация для обновления профиля
export const validateProfileUpdate = [
  body("bio")
    .optional()
    .trim()
    .isLength({ max: CONTENT_LIMITS.BIO_MAX })
    .withMessage(
      `Biografia nemôže presiahnuť ${CONTENT_LIMITS.BIO_MAX} znakov`
    )
    .escape(),

  body("avatar")
    .optional()
    .isURL()
    .withMessage("Neplatný formát URL pre avatar"),

  handleValidationErrors,
];

// Валидация для изменения роли пользователя (админ)
export const validateRoleChange = [
  param("id").isMongoId().withMessage("Neplatné ID používateľa"),

  body("role")
    .isIn(["user", "expert", "admin"])
    .withMessage("Rola musí byť: user, expert alebo admin"),

  body("reason")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Dôvod nemôže presiahnuť 500 znakov")
    .escape(),

  handleValidationErrors,
];

// Валидация для бана пользователя
export const validateUserBan = [
  param("id").isMongoId().withMessage("Neplatné ID používateľa"),

  body("reason")
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage("Dôvod banu musí byť od 10 do 500 znakov")
    .escape(),

  body("duration")
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage("Dĺžka banu musí byť od 1 do 365 dní"),

  handleValidationErrors,
];

// Валидация для создания жалобы
export const validateReportCreate = [
  body("targetId").isMongoId().withMessage("Neplatné ID objektu sťažnosti"),

  body("targetType")
    .isIn(["question", "answer", "comment"])
    .withMessage("Typ objektu musí byť: question, answer alebo comment"),

  body("reason")
    .isIn(["spam", "inappropriate", "offensive", "other"])
    .withMessage(
      "Dôvod musí byť: spam, nevhodné, urážlivé alebo iné"
    ),

  body("description")
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("Popis nemôže presiahnuť 1000 znakov")
    .escape(),

  handleValidationErrors,
];

// Валидация для поиска
export const validateSearch = [
  query("q")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("Vyhľadávací dopyt musí byť od 2 do 100 znakov")
    .escape(),

  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Číslo stránky musí byť kladné číslo"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage("Limit výsledkov musí byť od 1 do 50"),

  handleValidationErrors,
];

// Валидация для пагинации
export const validatePagination = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Číslo stránky musí byť kladné číslo"),

  query("limit")
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage("Limit výsledkov musí byť od 1 do 50"),

  handleValidationErrors,
];

// Валидация MongoDB ObjectId параметра
export const validateObjectId = (paramName = "id") => [
  param(paramName).isMongoId().withMessage(`Neplatné ${paramName}`),

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
