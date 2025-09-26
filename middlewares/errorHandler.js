// middlewares/errorHandler.js
import { formatResponse } from "../utils/helpers.js";
import { ERROR_MESSAGES, HTTP_STATUS } from "../utils/constants.js";
import { logError } from "./logger.js";
import config from "../config/index.js";

// Определение типа ошибки
const getErrorType = (error) => {
  if (error.name === "ValidationError") return "VALIDATION_ERROR";
  if (error.name === "CastError") return "CAST_ERROR";
  if (error.name === "MongoError" || error.name === "MongoServerError")
    return "DATABASE_ERROR";
  if (error.code === 11000) return "DUPLICATE_ERROR";
  if (error.name === "JsonWebTokenError") return "JWT_ERROR";
  if (error.name === "TokenExpiredError") return "TOKEN_EXPIRED";
  if (error.name === "MulterError") return "FILE_UPLOAD_ERROR";
  if (error.statusCode || error.status) return "HTTP_ERROR";
  return "INTERNAL_ERROR";
};

// Обработка ошибок валидации Mongoose
const handleValidationError = (error) => {
  const errors = Object.values(error.errors).map((err) => ({
    field: err.path,
    message: err.message,
    value: err.value,
  }));

  return {
    statusCode: HTTP_STATUS.BAD_REQUEST,
    message: "Chyba validácie údajov",
    details: {
      type: "ValidationError",
      errors,
    },
  };
};

// Обработка ошибок приведения типов
const handleCastError = (error) => {
  let message = "Nesprávny formát údajov";

  if (error.path === "_id") {
    message = "Nesprávne ID objektu";
  } else if (error.kind === "ObjectId") {
    message = `Nesprávny formát ID pre pole ${error.path}`;
  } else if (error.kind === "Number") {
    message = `Očakáva sa číslo pre pole ${error.path}`;
  } else if (error.kind === "Date") {
    message = `Nesprávny formát dátumu pre pole ${error.path}`;
  }

  return {
    statusCode: HTTP_STATUS.BAD_REQUEST,
    message,
    details: {
      type: "CastError",
      field: error.path,
      value: error.value,
      expectedType: error.kind,
    },
  };
};

// Обработка ошибок дублирования (unique constraint)
const handleDuplicateError = (error) => {
  const field = Object.keys(error.keyValue)[0];
  const value = error.keyValue[field];

  let message = `Hodnota "${value}" už existuje`;

  // Настройка сообщений для конкретных полей
  switch (field) {
    case "email":
      message = "Používateľ s týmto emailom už existuje";
      break;
    case "slug":
      message = "Objekt s týmto identifikátorom už existuje";
      break;
    case "name":
      message = "Objekt s týmto menom už existuje";
      break;
  }

  return {
    statusCode: HTTP_STATUS.CONFLICT,
    message,
    details: {
      type: "DuplicateError",
      field,
      value,
    },
  };
};

// Обработка ошибок JWT
const handleJwtError = (error) => {
  let message = "Neplatný token";
  let statusCode = HTTP_STATUS.UNAUTHORIZED;

  if (error.name === "TokenExpiredError") {
    message = "Token vypršal. Prosím, prihláste sa znova";
  } else if (error.message === "invalid signature") {
    message = "Neplatný podpis tokenu";
  } else if (error.message === "jwt malformed") {
    message = "Nesprávny formát tokenu";
  }

  return {
    statusCode,
    message,
    details: {
      type: error.name,
      reason: error.message,
    },
  };
};

// Обработка ошибок базы данных
const handleDatabaseError = (error) => {
  let message = "Chyba databázy";
  let statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;

  // Специфичные ошибки MongoDB
  if (error.code) {
    switch (error.code) {
      case 11000:
        return handleDuplicateError(error);
      case 121:
        message = "Dokument neprešiel validáciou schémy";
        statusCode = HTTP_STATUS.BAD_REQUEST;
        break;
      case 2:
        message = "Chyba v dotaze do databázy";
        statusCode = HTTP_STATUS.BAD_REQUEST;
        break;
      case 13:
        message = "Nedostatočné oprávnenia na vykonanie operácie";
        statusCode = HTTP_STATUS.FORBIDDEN;
        break;
      default:
        message = `Chyba databázy (kód: ${error.code})`;
    }
  }

  return {
    statusCode,
    message,
    details: {
      type: "DatabaseError",
      code: error.code,
      codeName: error.codeName,
    },
  };
};

// Обработка ошибок загрузки файлов
const handleFileUploadError = (error) => {
  let message = "Chyba pri nahrávaní súboru";
  let statusCode = HTTP_STATUS.BAD_REQUEST;

  switch (error.code) {
    case "LIMIT_FILE_SIZE":
      message = "Súbor je príliš veľký";
      break;
    case "LIMIT_FILE_COUNT":
      message = "Príliš veľa súborov";
      break;
    case "LIMIT_UNEXPECTED_FILE":
      message = "Neočakávané pole súboru";
      break;
    case "MISSING_FILE":
      message = "Súbor nebol nájdený";
      break;
    default:
      message = `Chyba nahrávania: ${error.message}`;
  }

  return {
    statusCode,
    message,
    details: {
      type: "FileUploadError",
      code: error.code,
      field: error.field,
    },
  };
};

// Основной обработчик ошибок
export const errorHandler = (error, req, res, next) => {
  // Логируем ошибку
  logError(error, `${req.method} ${req.originalUrl}`, req.user?.id);

  const errorType = getErrorType(error);
  let errorResponse;

  // Обрабатываем разные типы ошибок
  switch (errorType) {
    case "VALIDATION_ERROR":
      errorResponse = handleValidationError(error);
      break;
    case "CAST_ERROR":
      errorResponse = handleCastError(error);
      break;
    case "DUPLICATE_ERROR":
      errorResponse = handleDuplicateError(error);
      break;
    case "JWT_ERROR":
    case "TOKEN_EXPIRED":
      errorResponse = handleJwtError(error);
      break;
    case "DATABASE_ERROR":
      errorResponse = handleDatabaseError(error);
      break;
    case "FILE_UPLOAD_ERROR":
      errorResponse = handleFileUploadError(error);
      break;
    case "HTTP_ERROR":
      errorResponse = {
        statusCode: error.statusCode || error.status || HTTP_STATUS.BAD_REQUEST,
        message: error.message || "HTTP chyba",
        details: {
          type: "HTTPError",
        },
      };
      break;
    default:
      errorResponse = {
        statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        message:
          config.NODE_ENV === "production"
            ? "Interná chyba servera"
            : error.message,
        details: {
          type: "InternalError",
        },
      };
  }

  // В режиме разработки добавляем stack trace
  if (config.NODE_ENV !== "production") {
    errorResponse.details.stack = error.stack;
  }

  // Отправляем ответ
  res
    .status(errorResponse.statusCode)
    .json(
      formatResponse(false, null, errorResponse.message, errorResponse.details)
    );
};

// Обработчик несуществующих маршрутов (404)
export const notFoundHandler = (req, res, next) => {
  const error = new Error(`Trasa ${req.originalUrl} nebola nájdená`);
  error.statusCode = HTTP_STATUS.NOT_FOUND;
  next(error);
};

// Обработчик асинхронных функций (wrapper)
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Создание кастомной ошибки
export class AppError extends Error {
  constructor(
    message,
    statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR,
    details = null
  ) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Специализированные ошибки
export class ValidationError extends AppError {
  constructor(message, errors = []) {
    super(message, HTTP_STATUS.BAD_REQUEST, {
      type: "ValidationError",
      errors,
    });
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Zdroj") {
    super(`${resource} nebol nájdený`, HTTP_STATUS.NOT_FOUND, {
      type: "NotFoundError",
    });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Neautorizovaný prístup") {
    super(message, HTTP_STATUS.UNAUTHORIZED, { type: "UnauthorizedError" });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Zakázané") {
    super(message, HTTP_STATUS.FORBIDDEN, { type: "ForbiddenError" });
  }
}

export class ConflictError extends AppError {
  constructor(message = "Konflikt údajov") {
    super(message, HTTP_STATUS.CONFLICT, { type: "ConflictError" });
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Prekročený limit požiadaviek", resetTime = null) {
    super(message, HTTP_STATUS.TOO_MANY_REQUESTS, {
      type: "RateLimitError",
      resetTime,
    });
  }
}

// Middleware для обработки unhandled promise rejections
export const handleUnhandledRejections = () => {
  process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
    logError(new Error("Unhandled Promise Rejection"), "Process", null);

    // В production закрываем сервер gracefully
    if (config.NODE_ENV === "production") {
      process.exit(1);
    }
  });
};

// Middleware для обработки uncaught exceptions
export const handleUncaughtExceptions = () => {
  process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error);
    logError(error, "Process", null);

    process.exit(1);
  });
};

export default {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  AppError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  handleUnhandledRejections,
  handleUncaughtExceptions,
};
