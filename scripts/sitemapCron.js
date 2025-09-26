// scripts/sitemapCron.js

import cron from "node-cron";
import { sitemapService } from "../services/sitemapService.js";
import { sitemapConfig } from "../config/sitemap.js";
import { writeLog } from "../middlewares/logger.js";

/**
 * Флаг для предотвращения параллельного выполнения
 */
let isGenerating = false;

/**
 * Функция генерации sitemap с защитой от перекрытия
 */
async function generateSitemapSafe() {
  // Проверяем, не выполняется ли уже генерация
  if (isGenerating) {
    writeLog("WARN", "Sitemap generation already in progress, skipping...");
    return;
  }

  try {
    isGenerating = true;
    writeLog("INFO", "Starting sitemap generation...");

    // Запускаем генерацию
    const result = await sitemapService.generateSitemap();

    if (result.success) {
      writeLog(
        "INFO",
        `Sitemap generation completed successfully: ${result.urlsCount} URLs generated at ${result.generatedAt}`
      );
    } else {
      writeLog("ERROR", `Sitemap generation failed: ${result.error}`);
    }

    return result;
  } catch (error) {
    writeLog(
      "ERROR",
      `Unexpected error during sitemap generation: ${error.message}`
    );
    return {
      success: false,
      error: error.message,
    };
  } finally {
    // Освобождаем флаг в любом случае
    isGenerating = false;
  }
}

/**
 * Запускаем cron задачу
 */
function startSitemapCron() {
  const { schedule, timezone, runOnStart } = sitemapConfig.cron;

  writeLog("INFO", `Initializing sitemap cron job with schedule: ${schedule}`);

  // Настраиваем cron задачу (без runOnStart - его нет в node-cron)
  const task = cron.schedule(
    schedule,
    async () => {
      await generateSitemapSafe();
    },
    {
      scheduled: true,
      timezone: timezone,
    }
  );

  // Логируем успешную инициализацию
  writeLog("INFO", `Sitemap cron job started successfully`);
  writeLog("INFO", `Next runs: 00:00, 08:00, 16:00 (${timezone})`);

  // Ручной запуск при старте если нужен (используем флаг из конфига)
  if (runOnStart) {
    writeLog("INFO", "Sitemap will be generated immediately on server start");
    setTimeout(async () => {
      writeLog("INFO", "Starting initial sitemap generation...");
      await generateSitemapSafe();
    }, 2000); // Задержка 2 секунды для завершения инициализации
  }

  return task;
}

/**
 * Функция для ручного запуска (для использования в API или админке)
 */
async function generateSitemapManual() {
  writeLog("INFO", "Manual sitemap generation requested");
  return await generateSitemapSafe();
}

/**
 * Проверяем статус генерации
 */
function getSitemapStatus() {
  return {
    isGenerating,
    lastGenerated: sitemapService.lastGenerated,
    nextScheduledRuns: ["00:00", "08:00", "16:00"],
    timezone: sitemapConfig.cron.timezone,
  };
}

// Экспортируем функции
export { startSitemapCron, generateSitemapManual, getSitemapStatus };
