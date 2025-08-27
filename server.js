// server.js
import app from "./app.js";
import config from "./config/index.js";
import database from "./utils/database.js";
import { writeLog } from "./middlewares/logger.js";
// import { startScheduler } from './utils/logCleanup.js';

// Подключение к базе данных и запуск сервера
async function startServer() {
  try {
    // Подключаемся к MongoDB
    await database.connect();

    // Запускаем планировщик очистки логов
    // startScheduler(); // временно отключено

    // Запускаем HTTP сервер
    const server = app.listen(config.PORT, () => {
      writeLog(
        "SUCCESS",
        `Server running on port ${config.PORT} in ${config.NODE_ENV} mode`
      );
      writeLog("INFO", `API available at: http://localhost:${config.PORT}/api`);
      writeLog("INFO", `Health check: http://localhost:${config.PORT}/health`);

      // Логируем информацию о подключении к БД
      const dbInfo = database.getConnectionInfo();
      if (dbInfo) {
        writeLog(
          "INFO",
          `Database: ${dbInfo.name} on ${dbInfo.host}:${dbInfo.port}`
        );
      }
    });

    // Настройка graceful shutdown для сервера
    const gracefulShutdown = (signal) => {
      writeLog("INFO", `${signal} received. Closing HTTP server...`);

      server.close(async () => {
        writeLog("INFO", "HTTP server closed");

        try {
          await database.disconnect();
          writeLog("SUCCESS", "Graceful shutdown completed");
          process.exit(0);
        } catch (error) {
          writeLog("ERROR", `Error during shutdown: ${error.message}`);
          process.exit(1);
        }
      });
    };

    // Обработчики сигналов завершения
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));

    // Обработчик неперехваченных исключений
    process.on("uncaughtException", (error) => {
      writeLog("ERROR", `Uncaught Exception: ${error.message}`);
      console.error("Uncaught Exception:", error);
      gracefulShutdown("UNCAUGHT_EXCEPTION");
    });

    // Обработчик неперехваченных промисов
    process.on("unhandledRejection", (reason, promise) => {
      writeLog("ERROR", `Unhandled Rejection at ${promise}: ${reason}`);
      console.error("Unhandled Rejection:", reason);
      gracefulShutdown("UNHANDLED_REJECTION");
    });
  } catch (error) {
    writeLog("ERROR", `Failed to start server: ${error.message}`);
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Запускаем сервер
startServer();
