// utils/logCleanup.js
import cron from "node-cron";
import fs from "fs";
import path from "path";
import { writeLog } from "../middlewares/logger.js";

const logsDir = path.join(process.cwd(), "logs");

const cleanupOldLogs = (daysToKeep = 30) => {
  try {
    if (!fs.existsSync(logsDir)) {
      writeLog("INFO", "Logs directory does not exist, skipping cleanup");
      return;
    }

    const files = fs.readdirSync(logsDir);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    let deletedCount = 0;

    files.forEach((file) => {
      if (file.endsWith(".log")) {
        const filePath = path.join(logsDir, file);
        const stats = fs.statSync(filePath);

        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          writeLog("INFO", `Log cleanup: deleted old file ${file}`);
          deletedCount++;
        }
      }
    });

    writeLog(
      "SUCCESS",
      `Log cleanup completed: deleted ${deletedCount} files older than ${daysToKeep} days`
    );
  } catch (error) {
    writeLog("ERROR", `Log cleanup failed: ${error.message}`);
  }
};

export const startScheduler = () => {
  // Проверяем что cron синтаксис валидный
  if (!cron.validate("0 2 * * *")) {
    writeLog("ERROR", "Invalid cron expression for log cleanup");
    return;
  }

  // Запускаем очистку каждый день в 2:00 ночи (по времени Братиславы)
  cron.schedule(
    "0 2 * * *",
    () => {
      writeLog("INFO", "Starting scheduled log cleanup...");
      cleanupOldLogs(30);
    },
    {
      scheduled: true,
      timezone: "Europe/Bratislava",
    }
  );

  // Очистка при старте приложения (опционально)
  writeLog(
    "INFO",
    "Log cleanup scheduler started (daily at 2:00 AM Europe/Bratislava)"
  );
};

// Ручной запуск очистки
export const manualCleanup = (days = 30) => {
  writeLog("INFO", "Starting manual log cleanup...");
  cleanupOldLogs(days);
};
