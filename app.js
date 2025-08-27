// app.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import config from "./config/index.js";
import logger from "./middlewares/logger.js";
import { writeLog } from "./middlewares/logger.js";

// Создаем приложение Express
const app = express();

// Базовые middleware для безопасности
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false, // отключаем CSP для разработки
  })
);

// CORS настройки
app.use(
  cors({
    origin: function (origin, callback) {
      const allowedOrigins = [
        "http://localhost:3000",
        "http://localhost:3001",
        "https://fastcredit.sk",
        "https://www.fastcredit.sk",
      ];

      // Разрешаем запросы без origin (например, мобильные приложения)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        writeLog("WARN", `CORS blocked origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// Парсинг JSON и URL-encoded данных
app.use(
  express.json({
    limit: "10mb",
    strict: true,
  })
);
app.use(
  express.urlencoded({
    extended: true,
    limit: "10mb",
  })
);

// Логирование всех HTTP запросов
app.use(logger);

// Базовый rate limiting
const generalLimiter = rateLimit({
  windowMs: config.RATE_LIMIT.WINDOW_MS,
  max: config.RATE_LIMIT.USER.API_REQUESTS,
  message: {
    error: "Too many requests",
    message: "Превышен лимит запросов. Попробуйте позже.",
    retryAfter: Math.ceil(config.RATE_LIMIT.WINDOW_MS / 1000),
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress || "unknown";
    writeLog("WARN", `Rate limit exceeded for IP: ${clientIP} on ${req.path}`);

    res.status(429).json({
      success: false,
      error: "Too many requests",
      message: "Превышен лимит запросов. Попробуйте позже.",
      retryAfter: Math.ceil(config.RATE_LIMIT.WINDOW_MS / 1000),
    });
  },
});

app.use("/api", generalLimiter);

// Базовые роуты
app.get("/", (req, res) => {
  res.json({
    message: "QA Forum API",
    version: "1.0.0",
    status: "running",
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  });
});

// API роуты (будут добавлены позже)
// app.use('/api/auth', authRoutes);
// app.use('/api/questions', questionRoutes);
// app.use('/api/answers', answerRoutes);
// app.use('/api/comments', commentRoutes);
// app.use('/api/users', userRoutes);
// app.use('/api/experts', expertRoutes);
// app.use('/api/admin', adminRoutes);
// app.use('/api/reports', reportRoutes);

// 404 handler
app.use((req, res) => {
  writeLog("WARN", `404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    error: "Not Found",
    message: "Маршрут не найден",
    path: req.originalUrl,
  });
});

// Глобальный обработчик ошибок
app.use((error, req, res, next) => {
  writeLog(
    "ERROR",
    `Global error handler: ${error.message} | Stack: ${error.stack?.substring(
      0,
      200
    )}`
  );

  // Mongoose validation errors
  if (error.name === "ValidationError") {
    const errors = Object.values(error.errors).map((err) => err.message);
    return res.status(400).json({
      success: false,
      error: "Validation Error",
      message: "Ошибка валидации данных",
      details: errors,
    });
  }

  // Mongoose duplicate key error
  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    return res.status(409).json({
      success: false,
      error: "Duplicate Error",
      message: `${field} уже существует`,
      field,
    });
  }

  // JWT errors
  if (error.name === "JsonWebTokenError") {
    return res.status(401).json({
      success: false,
      error: "Invalid Token",
      message: "Недействительный токен",
    });
  }

  if (error.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      error: "Token Expired",
      message: "Токен истек",
    });
  }

  // Default error
  const statusCode = error.statusCode || error.status || 500;
  res.status(statusCode).json({
    success: false,
    error: error.name || "Internal Server Error",
    message:
      config.NODE_ENV === "production"
        ? "Произошла внутренняя ошибка сервера"
        : error.message,
    ...(config.NODE_ENV !== "production" && { stack: error.stack }),
  });
});

// Graceful shutdown handlers
const gracefulShutdown = (signal) => {
  writeLog("INFO", `${signal} received. Starting graceful shutdown...`);

  process.exit(0);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export default app;
