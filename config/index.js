// config/index.js
import dotenv from "dotenv";

dotenv.config();

const config = {
  // Server
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: process.env.PORT || 10001,

  // Database
  MONGODB_URI:
    process.env.MONGODB_URI || "mongodb://localhost:27017/qa_service",

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || "fallback_secret_key",
  JWT_EXPIRES_IN: "7d",

  // External Services
  AUTH_SERVICE_URL: process.env.AUTH_SERVICE_URL || "http://localhost:3002",

  // Redis
  REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",

  // Admin
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || "admin@fastcredit.sk",

  // Rate Limiting
  RATE_LIMIT: {
    WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 3600000, // 1 час
    USER: {
      QUESTIONS: 5,
      COMMENTS: 30,
      LIKES: 100,
      API_REQUESTS: 1000,
    },
    EXPERT: {
      QUESTIONS: 10,
      ANSWERS: 20,
      COMMENTS: 50,
      LIKES: 100,
      API_REQUESTS: 1000,
    },
    ADMIN: {
      API_REQUESTS: 5000, // админы без ограничений на основные действия
    },
  },

  // Content Validation
  VALIDATION: {
    QUESTION: {
      TITLE_MIN: 10,
      TITLE_MAX: 200,
      CONTENT_MIN: 20,
      CONTENT_MAX: 5000,
    },
    ANSWER: {
      CONTENT_MIN: 50,
      CONTENT_MAX: 10000,
    },
    COMMENT: {
      CONTENT_MIN: 5,
      CONTENT_MAX: 1000,
    },
    BIO: {
      MAX: 500,
    },
  },

  // Security
  BCRYPT_ROUNDS: 12,

  // Logging
  LOG_CLEANUP_DAYS: 30,
};

export default config;
