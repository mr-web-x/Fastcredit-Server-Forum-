// services/validationService.js
import {
  CONTENT_LIMITS,
  USER_ROLES,
  QUESTION_PRIORITY,
  REPORT_TARGET_TYPES,
  REPORT_REASONS,
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
          errors.push({ field: "title", message: "Nadpis je povinný" });
        } else {
          const trimmedTitle = title.trim();
          if (trimmedTitle.length < CONTENT_LIMITS.QUESTION_TITLE_MIN) {
            errors.push({
              field: "title",
              message: `Nadpis musí obsahovať minimálne ${CONTENT_LIMITS.QUESTION_TITLE_MIN} znakov`,
            });
          }
          if (trimmedTitle.length > CONTENT_LIMITS.QUESTION_TITLE_MAX) {
            errors.push({
              field: "title",
              message: `Nadpis môže obsahovať maximálne ${CONTENT_LIMITS.QUESTION_TITLE_MAX} znakov`,
            });
          }

          // Проверка на недопустимые символы
          if (this.containsInvalidCharacters(trimmedTitle)) {
            errors.push({
              field: "title",
              message: "Nadpis obsahuje nepovolené znaky",
            });
          }
        }
      }

      // Валидация контента
      if (!isUpdate || content !== undefined) {
        if (!content || typeof content !== "string") {
          errors.push({ field: "content", message: "Obsah je povinný" });
        } else {
          const trimmedContent = content.trim();
          if (trimmedContent.length < CONTENT_LIMITS.QUESTION_CONTENT_MIN) {
            errors.push({
              field: "content",
              message: `Obsah musí obsahovať minimálne ${CONTENT_LIMITS.QUESTION_CONTENT_MIN} znakov`,
            });
          }
          if (trimmedContent.length > CONTENT_LIMITS.QUESTION_CONTENT_MAX) {
            errors.push({
              field: "content",
              message: `Obsah môže obsahovať maximálne ${CONTENT_LIMITS.QUESTION_CONTENT_MAX} znakov`,
            });
          }
        }
      }

      // Валидация категории (опционально)
      if (category !== undefined) {
        if (typeof category !== "string" || !this.isValidCategory(category)) {
          errors.push({ field: "category", message: "Neplatná kategória" });
        }
      }

      // Валидация приоритета (опционально)
      if (priority !== undefined) {
        if (!Object.values(QUESTION_PRIORITY).includes(priority)) {
          errors.push({ field: "priority", message: "Neplatná priorita" });
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
        errors: [{ field: "general", message: "Chyba pri validácii údajov" }],
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
          message: "Obsah odpovede je povinný",
        });
      } else {
        const trimmedContent = content.trim();
        if (trimmedContent.length < CONTENT_LIMITS.ANSWER_CONTENT_MIN) {
          errors.push({
            field: "content",
            message: `Odpoveď musí obsahovať minimálne ${CONTENT_LIMITS.ANSWER_CONTENT_MIN} znakov`,
          });
        }
        if (trimmedContent.length > CONTENT_LIMITS.ANSWER_CONTENT_MAX) {
          errors.push({
            field: "content",
            message: `Odpoveď môže obsahovať maximálne ${CONTENT_LIMITS.ANSWER_CONTENT_MAX} znakov`,
          });
        }
      }

      // Валидация ID вопроса
      if (!questionId) {
        errors.push({ field: "questionId", message: "ID otázky je povinné" });
      } else if (!isValidObjectId(questionId)) {
        errors.push({
          field: "questionId",
          message: "Neplatný formát ID otázky",
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
          { field: "general", message: "Chyba pri validácii údajov odpovede" },
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
          message: "Obsah komentára je povinný",
        });
      } else {
        const trimmedContent = content.trim();
        if (trimmedContent.length < CONTENT_LIMITS.COMMENT_CONTENT_MIN) {
          errors.push({
            field: "content",
            message: `Komentár musí obsahovať minimálne ${CONTENT_LIMITS.COMMENT_CONTENT_MIN} znakov`,
          });
        }
        if (trimmedContent.length > CONTENT_LIMITS.COMMENT_CONTENT_MAX) {
          errors.push({
            field: "content",
            message: `Komentár môže obsahovať maximálne ${CONTENT_LIMITS.COMMENT_CONTENT_MAX} znakov`,
          });
        }
      }

      // Валидация ID вопроса
      if (!questionId) {
        errors.push({ field: "questionId", message: "ID otázky je povinné" });
      } else if (!isValidObjectId(questionId)) {
        errors.push({
          field: "questionId",
          message: "Neplatný formát ID otázky",
        });
      }

      // Валидация родительского комментария (опционально)
      if (parentComment && !isValidObjectId(parentComment)) {
        errors.push({
          field: "parentComment",
          message: "Neplatný formát ID rodičovského komentára",
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
          { field: "general", message: "Chyba pri validácii údajov komentára" },
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
          errors.push({ field: "email", message: "Email je povinný" });
        } else if (!this.isValidEmail(email)) {
          errors.push({ field: "email", message: "Neplatný formát emailu" });
        }
      }

      // Валидация биографии (опционально)
      if (bio !== undefined) {
        if (typeof bio !== "string") {
          errors.push({
            field: "bio",
            message: "Biografia musí byť reťazec",
          });
        } else if (bio.length > CONTENT_LIMITS.BIO_MAX) {
          errors.push({
            field: "bio",
            message: `Biografia môže obsahovať maximálne ${CONTENT_LIMITS.BIO_MAX} znakov`,
          });
        }
      }

      // Валидация аватара (опционально)
      if (avatar !== undefined && avatar !== null) {
        if (typeof avatar !== "string" || !this.isValidUrl(avatar)) {
          errors.push({ field: "avatar", message: "Neplatná URL adresa avatara" });
        }
      }

      // Валидация роли (только для админов)
      if (role !== undefined) {
        if (!Object.values(USER_ROLES).includes(role)) {
          errors.push({
            field: "role",
            message: "Neplatná rola používateľa",
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
          { field: "general", message: "Chyba pri validácii údajov používateľa" },
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
        errors.push({ field: "targetId", message: "ID objektu je povinné" });
      } else if (!isValidObjectId(targetId)) {
        errors.push({
          field: "targetId",
          message: "Neplatný formát ID objektu",
        });
      }

      // Валидация типа объекта
      if (
        !targetType ||
        !Object.values(REPORT_TARGET_TYPES).includes(targetType)
      ) {
        errors.push({
          field: "targetType",
          message: "Neplatný typ objektu",
        });
      }

      // Валидация причины жалобы
      if (!reason || !Object.values(REPORT_REASONS).includes(reason)) {
        errors.push({
          field: "reason",
          message: "Neplatný dôvod sťažnosti",
        });
      }

      // Валидация описания (опционально)
      if (description !== undefined) {
        if (typeof description !== "string") {
          errors.push({
            field: "description",
            message: "Popis musí byť reťazec",
          });
        } else if (description.length > 1000) {
          errors.push({
            field: "description",
            message: "Popis môže obsahovať maximálne 1000 znakov",
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
          { field: "general", message: "Chyba pri validácii údajov sťažnosti" },
        ],
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
        errors.push({ field: "query", message: "Vyhľadávací dopyt je povinný" });
      } else {
        const trimmedQuery = query.trim();
        if (trimmedQuery.length < 2) {
          errors.push({
            field: "query",
            message: "Vyhľadávací dopyt musí obsahovať minimálne 2 znaky",
          });
        }
        if (trimmedQuery.length > 100) {
          errors.push({
            field: "query",
            message: "Vyhľadávací dopyt môže obsahovať maximálne 100 znakov",
          });
        }

        // Проверка на потенциально опасные паттерны
        if (this.containsInvalidCharacters(trimmedQuery)) {
          errors.push({
            field: "query",
            message: "Vyhľadávací dopyt obsahuje nepovolené znaky",
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
          { field: "general", message: "Chyba pri validácii vyhľadávacieho dopytu" },
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
        errors.push({ field: "userId", message: "ID používateľa je povinné" });
      } else if (!isValidObjectId(userId)) {
        errors.push({
          field: "userId",
          message: "Neplatný formát ID používateľa",
        });
      }

      // Валидация новой роли
      if (!newRole) {
        errors.push({ field: "newRole", message: "Nová rola je povinná" });
      } else if (!Object.values(USER_ROLES).includes(newRole)) {
        errors.push({
          field: "newRole",
          message: "Neplatná rola používateľa",
        });
      }

      // Валидация причины (опционально)
      if (reason !== undefined) {
        if (typeof reason !== "string") {
          errors.push({
            field: "reason",
            message: "Dôvod musí byť reťazec",
          });
        } else if (reason.length > 500) {
          errors.push({
            field: "reason",
            message: "Dôvod môže obsahovať maximálne 500 znakov",
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
          { field: "general", message: "Chyba pri validácii údajov zmeny roly" },
        ],
      };
    }
  }

  // Валидация пагинации
  validatePaginationData(data) {
    try {
      const errors = [];
      let { page, limit } = data;

      // Валидация страницы
      if (page !== undefined) {
        const pageNum = parseInt(page);
        if (isNaN(pageNum) || pageNum < 1) {
          errors.push({
            field: "page",
            message: "Číslo stránky musí byť kladné číslo",
          });
        } else if (pageNum > 1000) {
          errors.push({
            field: "page",
            message: "Číslo stránky nemôže byť väčšie ako 1000",
          });
        }
      }

      // Валидация лимита
      if (limit !== undefined) {
        const limitNum = parseInt(limit);
        if (isNaN(limitNum) || limitNum < 1) {
          errors.push({
            field: "limit",
            message: "Limit musí byť kladné číslo",
          });
        } else if (limitNum > 100) {
          errors.push({
            field: "limit",
            message: "Limit nemôže byť väčší ako 100",
          });
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
        normalized: {
          page: page ? Math.max(1, parseInt(page)) : 1,
          limit: limit ? Math.min(100, Math.max(1, parseInt(limit))) : 20,
        },
      };
    } catch (error) {
      logError(error, "ValidationService.validatePaginationData");
      return {
        isValid: false,
        errors: [
          { field: "general", message: "Chyba pri validácii údajov stránkovania" },
        ],
        normalized: { page: 1, limit: 20 },
      };
    }
  }
}

export default new ValidationService();
