// services/validationService.js
import {
  CONTENT_LIMITS,
  USER_ROLES,
  QUESTION_STATUS,
  QUESTION_PRIORITY,
} from "../utils/constants.js";
import { isValidObjectId } from "../utils/helpers.js";
import { logError } from "../middlewares/logger.js";

class ValidationService {
  // Валидация данных вопроса
  validateQuestionData(data, isUpdate = false) {
    try {
      const errors = [];
      const { title, content, category, priority } = data;

      // Валидация заголовка
      if (!isUpdate || title !== undefined) {
        if (!title || typeof title !== "string") {
          errors.push({ field: "title", message: "Заголовок обязателен" });
        } else {
          const trimmedTitle = title.trim();
          if (trimmedTitle.length < CONTENT_LIMITS.QUESTION_TITLE_MIN) {
            errors.push({
              field: "title",
              message: `Заголовок должен содержать минимум ${CONTENT_LIMITS.QUESTION_TITLE_MIN} символов`,
            });
          }
          if (trimmedTitle.length > CONTENT_LIMITS.QUESTION_TITLE_MAX) {
            errors.push({
              field: "title",
              message: `Заголовок должен содержать максимум ${CONTENT_LIMITS.QUESTION_TITLE_MAX} символов`,
            });
          }

          // Проверка на недопустимые символы
          if (this.containsInvalidCharacters(trimmedTitle)) {
            errors.push({
              field: "title",
              message: "Заголовок содержит недопустимые символы",
            });
          }
        }
      }

      // Валидация контента
      if (!isUpdate || content !== undefined) {
        if (!content || typeof content !== "string") {
          errors.push({ field: "content", message: "Содержание обязательно" });
        } else {
          const trimmedContent = content.trim();
          if (trimmedContent.length < CONTENT_LIMITS.QUESTION_CONTENT_MIN) {
            errors.push({
              field: "content",
              message: `Содержание должно содержать минимум ${CONTENT_LIMITS.QUESTION_CONTENT_MIN} символов`,
            });
          }
          if (trimmedContent.length > CONTENT_LIMITS.QUESTION_CONTENT_MAX) {
            errors.push({
              field: "content",
              message: `Содержание должно содержать максимум ${CONTENT_LIMITS.QUESTION_CONTENT_MAX} символов`,
            });
          }
        }
      }

      // Валидация категории (опционально)
      if (category !== undefined) {
        if (typeof category !== "string" || !this.isValidCategory(category)) {
          errors.push({ field: "category", message: "Недопустимая категория" });
        }
      }

      // Валидация приоритета (опционально)
      if (priority !== undefined) {
        if (!Object.values(QUESTION_PRIORITY).includes(priority)) {
          errors.push({ field: "priority", message: "Недопустимый приоритет" });
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    } catch (error) {
      logError(error, "ValidationService.validateQuestionData");
      return {
        isValid: false,
        errors: [{ field: "general", message: "Ошибка валидации данных" }],
      };
    }
  }

  // Валидация данных ответа
  validateAnswerData(data) {
    try {
      const errors = [];
      const { content, questionId } = data;

      // Валидация контента
      if (!content || typeof content !== "string") {
        errors.push({
          field: "content",
          message: "Содержание ответа обязательно",
        });
      } else {
        const trimmedContent = content.trim();
        if (trimmedContent.length < CONTENT_LIMITS.ANSWER_CONTENT_MIN) {
          errors.push({
            field: "content",
            message: `Ответ должен содержать минимум ${CONTENT_LIMITS.ANSWER_CONTENT_MIN} символов`,
          });
        }
        if (trimmedContent.length > CONTENT_LIMITS.ANSWER_CONTENT_MAX) {
          errors.push({
            field: "content",
            message: `Ответ должен содержать максимум ${CONTENT_LIMITS.ANSWER_CONTENT_MAX} символов`,
          });
        }
      }

      // Валидация ID вопроса
      if (!questionId) {
        errors.push({ field: "questionId", message: "ID вопроса обязателен" });
      } else if (!isValidObjectId(questionId)) {
        errors.push({
          field: "questionId",
          message: "Недопустимый формат ID вопроса",
        });
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    } catch (error) {
      logError(error, "ValidationService.validateAnswerData");
      return {
        isValid: false,
        errors: [
          { field: "general", message: "Ошибка валидации данных ответа" },
        ],
      };
    }
  }

  // Валидация данных комментария
  validateCommentData(data) {
    try {
      const errors = [];
      const { content, questionId, parentComment } = data;

      // Валидация контента
      if (!content || typeof content !== "string") {
        errors.push({
          field: "content",
          message: "Содержание комментария обязательно",
        });
      } else {
        const trimmedContent = content.trim();
        if (trimmedContent.length < CONTENT_LIMITS.COMMENT_CONTENT_MIN) {
          errors.push({
            field: "content",
            message: `Комментарий должен содержать минимум ${CONTENT_LIMITS.COMMENT_CONTENT_MIN} символов`,
          });
        }
        if (trimmedContent.length > CONTENT_LIMITS.COMMENT_CONTENT_MAX) {
          errors.push({
            field: "content",
            message: `Комментарий должен содержать максимум ${CONTENT_LIMITS.COMMENT_CONTENT_MAX} символов`,
          });
        }
      }

      // Валидация ID вопроса
      if (!questionId) {
        errors.push({ field: "questionId", message: "ID вопроса обязателен" });
      } else if (!isValidObjectId(questionId)) {
        errors.push({
          field: "questionId",
          message: "Недопустимый формат ID вопроса",
        });
      }

      // Валидация родительского комментария (опционально)
      if (parentComment && !isValidObjectId(parentComment)) {
        errors.push({
          field: "parentComment",
          message: "Недопустимый формат ID родительского комментария",
        });
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    } catch (error) {
      logError(error, "ValidationService.validateCommentData");
      return {
        isValid: false,
        errors: [
          { field: "general", message: "Ошибка валидации данных комментария" },
        ],
      };
    }
  }

  // Валидация данных пользователя
  validateUserData(data, isUpdate = false) {
    try {
      const errors = [];
      const { email, bio, avatar, role } = data;

      // Валидация email
      if (!isUpdate || email !== undefined) {
        if (!email || typeof email !== "string") {
          errors.push({ field: "email", message: "Email обязателен" });
        } else if (!this.isValidEmail(email)) {
          errors.push({ field: "email", message: "Недопустимый формат email" });
        }
      }

      // Валидация биографии (опционально)
      if (bio !== undefined) {
        if (typeof bio !== "string") {
          errors.push({
            field: "bio",
            message: "Биография должна быть строкой",
          });
        } else if (bio.length > CONTENT_LIMITS.BIO_MAX) {
          errors.push({
            field: "bio",
            message: `Биография должна содержать максимум ${CONTENT_LIMITS.BIO_MAX} символов`,
          });
        }
      }

      // Валидация аватара (опционально)
      if (avatar !== undefined && avatar !== null) {
        if (typeof avatar !== "string" || !this.isValidUrl(avatar)) {
          errors.push({ field: "avatar", message: "Недопустимый URL аватара" });
        }
      }

      // Валидация роли (только для админов)
      if (role !== undefined) {
        if (!Object.values(USER_ROLES).includes(role)) {
          errors.push({
            field: "role",
            message: "Недопустимая роль пользователя",
          });
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    } catch (error) {
      logError(error, "ValidationService.validateUserData");
      return {
        isValid: false,
        errors: [
          { field: "general", message: "Ошибка валидации данных пользователя" },
        ],
      };
    }
  }

  // Валидация данных жалобы
  validateReportData(data) {
    try {
      const errors = [];
      const { targetId, targetType, reason, description } = data;

      // Валидация целевого объекта
      if (!targetId) {
        errors.push({ field: "targetId", message: "ID объекта обязателен" });
      } else if (!isValidObjectId(targetId)) {
        errors.push({
          field: "targetId",
          message: "Недопустимый формат ID объекта",
        });
      }

      // Валидация типа объекта
      const validTargetTypes = ["question", "answer", "comment"];
      if (!targetType || !validTargetTypes.includes(targetType)) {
        errors.push({
          field: "targetType",
          message: "Недопустимый тип объекта",
        });
      }

      // Валидация причины
      const validReasons = ["spam", "inappropriate", "offensive", "other"];
      if (!reason || !validReasons.includes(reason)) {
        errors.push({
          field: "reason",
          message: "Недопустимая причина жалобы",
        });
      }

      // Валидация описания (опционально)
      if (description !== undefined) {
        if (typeof description !== "string") {
          errors.push({
            field: "description",
            message: "Описание должно быть строкой",
          });
        } else if (description.length > 1000) {
          errors.push({
            field: "description",
            message: "Описание должно содержать максимум 1000 символов",
          });
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    } catch (error) {
      logError(error, "ValidationService.validateReportData");
      return {
        isValid: false,
        errors: [
          { field: "general", message: "Ошибка валидации данных жалобы" },
        ],
      };
    }
  }

  // Валидация пагинации
  validatePaginationParams(params) {
    try {
      const errors = [];
      let { page = 1, limit = 20 } = params;

      // Валидация и нормализация страницы
      page = parseInt(page);
      if (isNaN(page) || page < 1) {
        page = 1;
      }
      if (page > 1000) {
        // максимальная страница
        errors.push({
          field: "page",
          message: "Номер страницы слишком большой",
        });
      }

      // Валидация и нормализация лимита
      limit = parseInt(limit);
      if (isNaN(limit) || limit < 1) {
        limit = 20;
      }
      if (limit > 100) {
        // максимальный лимит
        limit = 100;
      }

      return {
        isValid: errors.length === 0,
        errors,
        normalized: { page, limit },
      };
    } catch (error) {
      logError(error, "ValidationService.validatePaginationParams");
      return {
        isValid: false,
        errors: [
          {
            field: "general",
            message: "Ошибка валидации параметров пагинации",
          },
        ],
        normalized: { page: 1, limit: 20 },
      };
    }
  }

  // Проверка валидности email
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // Проверка валидности URL
  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  // Проверка валидности категории
  isValidCategory(category) {
    const validCategories = [
      "general",
      "loans",
      "credit",
      "banking",
      "insurance",
    ];
    return validCategories.includes(category);
  }

  // Проверка на недопустимые символы
  containsInvalidCharacters(text) {
    // Проверяем на потенциально опасные символы
    const dangerousPatterns = [
      /<script/i,
      /javascript:/i,
      /onload=/i,
      /onerror=/i,
      /onclick=/i,
    ];

    return dangerousPatterns.some((pattern) => pattern.test(text));
  }

  // Валидация поискового запроса
  validateSearchQuery(query) {
    try {
      const errors = [];

      if (!query || typeof query !== "string") {
        errors.push({ field: "query", message: "Поисковый запрос обязателен" });
      } else {
        const trimmedQuery = query.trim();
        if (trimmedQuery.length < 2) {
          errors.push({
            field: "query",
            message: "Поисковый запрос должен содержать минимум 2 символа",
          });
        }
        if (trimmedQuery.length > 100) {
          errors.push({
            field: "query",
            message: "Поисковый запрос должен содержать максимум 100 символов",
          });
        }

        // Проверка на потенциально опасные паттерны
        if (this.containsInvalidCharacters(trimmedQuery)) {
          errors.push({
            field: "query",
            message: "Поисковый запрос содержит недопустимые символы",
          });
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
        normalized: query ? query.trim() : "",
      };
    } catch (error) {
      logError(error, "ValidationService.validateSearchQuery");
      return {
        isValid: false,
        errors: [
          { field: "general", message: "Ошибка валидации поискового запроса" },
        ],
        normalized: "",
      };
    }
  }

  // Валидация данных для смены роли
  validateRoleChangeData(data) {
    try {
      const errors = [];
      const { userId, newRole, reason } = data;

      // Валидация ID пользователя
      if (!userId) {
        errors.push({ field: "userId", message: "ID пользователя обязателен" });
      } else if (!isValidObjectId(userId)) {
        errors.push({
          field: "userId",
          message: "Недопустимый формат ID пользователя",
        });
      }

      // Валидация новой роли
      if (!newRole) {
        errors.push({ field: "newRole", message: "Новая роль обязательна" });
      } else if (!Object.values(USER_ROLES).includes(newRole)) {
        errors.push({ field: "newRole", message: "Недопустимая роль" });
      }

      // Валидация причины (опционально)
      if (reason !== undefined) {
        if (typeof reason !== "string") {
          errors.push({
            field: "reason",
            message: "Причина должна быть строкой",
          });
        } else if (reason.length > 500) {
          errors.push({
            field: "reason",
            message: "Причина должна содержать максимум 500 символов",
          });
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
      };
    } catch (error) {
      logError(error, "ValidationService.validateRoleChangeData");
      return {
        isValid: false,
        errors: [
          { field: "general", message: "Ошибка валидации данных смены роли" },
        ],
      };
    }
  }

  // Общая функция валидации массива данных
  validateBatch(dataArray, validationFunction) {
    try {
      const results = [];

      if (!Array.isArray(dataArray)) {
        return {
          isValid: false,
          errors: [
            { field: "general", message: "Данные должны быть массивом" },
          ],
          results: [],
        };
      }

      if (dataArray.length === 0) {
        return {
          isValid: false,
          errors: [
            { field: "general", message: "Массив данных не может быть пустым" },
          ],
          results: [],
        };
      }

      if (dataArray.length > 100) {
        return {
          isValid: false,
          errors: [
            {
              field: "general",
              message: "Максимальный размер массива: 100 элементов",
            },
          ],
          results: [],
        };
      }

      let hasErrors = false;

      dataArray.forEach((item, index) => {
        const validation = validationFunction(item);
        results.push({
          index,
          ...validation,
        });

        if (!validation.isValid) {
          hasErrors = true;
        }
      });

      return {
        isValid: !hasErrors,
        errors: hasErrors
          ? [
              {
                field: "general",
                message: "Некоторые элементы не прошли валидацию",
              },
            ]
          : [],
        results,
      };
    } catch (error) {
      logError(error, "ValidationService.validateBatch");
      return {
        isValid: false,
        errors: [{ field: "general", message: "Ошибка пакетной валидации" }],
        results: [],
      };
    }
  }
}

export default new ValidationService();
