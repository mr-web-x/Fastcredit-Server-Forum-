// services/sitemap/SitemapService.js

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { sitemapConfig } from "../config/sitemap.js";
import { writeLog } from "../middlewares/logger.js";
import Question from "../models/Question.js";

// Получаем __dirname для ES6 модулей
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SitemapService {
  constructor() {
    this.config = sitemapConfig;
    this.urls = [];
    this.lastGenerated = null;
  }

  /**
   * Главный метод генерации sitemap
   * Принцип "ВСЕ ИЛИ НИЧЕГО"
   */
  async generateSitemap() {
    try {
      writeLog("INFO", "Sitemap generation started");
      this.urls = []; // Очищаем массив URL

      // 1. Собираем все данные
      await this._addStaticPages();
      await this._addWatchedFiles();
      await this._addBlogArticles();
      await this._addTypyPoziciekArticles();
      await this._addForumQuestions();
      await this._addDynamicParents();

      // 2. Проверяем лимиты
      if (this.urls.length > this.config.limits.maxUrls) {
        throw new Error(
          `Too many URLs: ${this.urls.length} > ${this.config.limits.maxUrls}`
        );
      }
      // Сортровка страниц по приоритету (b - a = ВЫСОКИЙ приоритет ВВЕРХ!)
      this.urls = this.urls.sort(
        (a, b) => (b.priority || 0) - (a.priority || 0)
      );
      // 3. Генерируем XML
      const xml = this._buildXmlSitemap(this.urls);

      // 4. Если ВСЕ успешно - делаем backup и записываем новый
      await this._backupOldSitemap();
      await this._writeNewSitemap(xml);
      await this._cleanupOldBackups();

      this.lastGenerated = new Date();
      writeLog(
        "INFO",
        `Sitemap generated successfully: ${this.urls.length} URLs`
      );

      return {
        success: true,
        urlsCount: this.urls.length,
        generatedAt: this.lastGenerated,
      };
    } catch (error) {
      writeLog("ERROR", `Sitemap generation failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Добавляем статические страницы из конфига
   */
  async _addStaticPages() {
    for (const page of this.config.staticPages) {
      this.urls.push({
        loc: `${this.config.siteUrl}${page.path}`,
        lastmod: page.lastModified,
        changefreq: page.changeFreq,
        priority: page.priority,
      });
    }

    if (this.config.logging.verbose) {
      writeLog("INFO", `Added ${this.config.staticPages.length} static pages`);
    }
  }

  /**
   * Добавляем отслеживаемые файлы (используем mtime)
   */
  async _addWatchedFiles() {
    for (const watchedFile of this.config.watchedFiles) {
      try {
        const filePath = path.resolve(__dirname, watchedFile.filePath);
        const stats = await fs.stat(filePath);

        this.urls.push({
          loc: `${this.config.siteUrl}${watchedFile.url}`,
          lastmod: stats.mtime.toISOString().split("T")[0], // YYYY-MM-DD
          changefreq: watchedFile.changeFreq,
          priority: watchedFile.priority,
        });

        if (this.config.logging.verbose) {
          writeLog(
            "INFO",
            `Added watched file: ${
              watchedFile.url
            }, mtime: ${stats.mtime.toDateString()}`
          );
        }
      } catch (error) {
        writeLog(
          "WARN",
          `Failed to read watched file ${watchedFile.filePath}: ${error.message}`
        );
      }
    }
  }

  /**
   * Добавляем динамические родительские страницы
   * Их lastModified рассчитывается на основе триггеров (дочерних элементов)
   */
  async _addDynamicParents() {
    // Сначала анализируем уже собранные URL и группируем даты по типам
    const datesByType = this._analyzeDatesByType();

    for (const parent of this.config.dynamicParents) {
      // Рассчитываем lastModified на основе триггеров
      const lastModified = this._calculateParentLastModified(
        parent.triggers,
        datesByType
      );

      this.urls.push({
        loc: `${this.config.siteUrl}${parent.path}`,
        lastmod: lastModified,
        changefreq: parent.changeFreq,
        priority: parent.priority,
      });
    }

    if (this.config.logging.verbose) {
      writeLog(
        "INFO",
        `Added ${this.config.dynamicParents.length} dynamic parent pages with calculated dates`
      );
    }
  }

  /**
   * Анализируем уже собранные URL и группируем даты по типам контента
   */
  _analyzeDatesByType() {
    const datesByType = {
      blog: [],
      typyPoziciek: [],
      forumQuestions: [],
      watchedFiles: [],
    };

    for (const url of this.urls) {
      const urlPath = url.loc.replace(this.config.siteUrl, "");

      // Определяем тип контента по URL
      if (urlPath.startsWith("/blog/")) {
        datesByType.blog.push(url.lastmod);
      } else if (urlPath.startsWith("/typy-poziciek/")) {
        datesByType.typyPoziciek.push(url.lastmod);
      } else if (urlPath.startsWith("/forum/questions/")) {
        datesByType.forumQuestions.push(url.lastmod);
      } else if (urlPath === "/slovnik.html") {
        datesByType.watchedFiles.push(url.lastmod);
      }
    }

    // Находим максимальную дату для каждого типа
    const maxDates = {};
    for (const [type, dates] of Object.entries(datesByType)) {
      if (dates.length > 0) {
        // Сортируем даты и берем самую новую
        dates.sort();
        maxDates[type] = dates[dates.length - 1];
      } else {
        // Если нет данных этого типа - используем вчерашнюю дату
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        maxDates[type] = yesterday.toISOString().split("T")[0];
      }
    }

    return maxDates;
  }

  /**
   * Рассчитываем lastModified для родительской страницы на основе триггеров
   */
  _calculateParentLastModified(triggers, datesByType) {
    const relevantDates = [];

    // Собираем даты из всех триггеров
    for (const trigger of triggers) {
      if (datesByType[trigger]) {
        relevantDates.push(datesByType[trigger]);
      }
    }

    if (relevantDates.length === 0) {
      // Если нет релевантных дат - используем сегодняшнюю
      return new Date().toISOString().split("T")[0];
    }

    // Возвращаем самую новую дату из всех триггеров
    relevantDates.sort();
    return relevantDates[relevantDates.length - 1];
  }

  /**
   * Сканируем и добавляем статьи блога
   */
  async _addBlogArticles() {
    const blogDir = path.resolve(__dirname, this.config.paths.blogDir);

    try {
      const files = await this._scanHtmlFiles(blogDir);

      for (const file of files) {
        const url = `/blog/${file.name}`;

        this.urls.push({
          loc: `${this.config.siteUrl}${url}`,
          lastmod: file.mtime,
          changefreq: this.config.changeFrequencies.blog,
          priority: this.config.priorities.blog,
        });
      }

      if (this.config.logging.verbose) {
        writeLog("INFO", `Added ${files.length} blog articles`);
      }
    } catch (error) {
      writeLog("WARN", `Failed to scan blog directory: ${error.message}`);
    }
  }

  /**
   * Сканируем и добавляем статьи про кредиты
   */
  async _addTypyPoziciekArticles() {
    const typyDir = path.resolve(__dirname, this.config.paths.typyPoziciekDir);

    try {
      const files = await this._scanHtmlFiles(typyDir);

      for (const file of files) {
        const url = `/typy-poziciek/${file.name}`;

        this.urls.push({
          loc: `${this.config.siteUrl}${url}`,
          lastmod: file.mtime,
          changefreq: this.config.changeFrequencies.typyPoziciek,
          priority: this.config.priorities.typyPoziciek,
        });
      }

      if (this.config.logging.verbose) {
        writeLog("INFO", `Added ${files.length} typy-poziciek articles`);
      }
    } catch (error) {
      writeLog(
        "WARN",
        `Failed to scan typy-poziciek directory: ${error.message}`
      );
    }
  }

  /**
   * Добавляем отвеченные вопросы форума из БД
   */
  async _addForumQuestions() {
    try {
      // Находим все отвеченные вопросы
      const answeredQuestions = await Question.find({
        status: "answered",
      })
        .select("slug updatedAt")
        .lean();

      for (const question of answeredQuestions) {
        const url = `/forum/questions/${question.slug}`;

        this.urls.push({
          loc: `${this.config.siteUrl}${url}`,
          lastmod: question.updatedAt.toISOString().split("T")[0],
          changefreq: this.config.changeFrequencies.forumQuestions,
          priority: this.config.priorities.forumQuestions,
        });
      }

      if (this.config.logging.verbose) {
        writeLog("INFO", `Added ${answeredQuestions.length} forum questions`);
      }
    } catch (error) {
      writeLog("WARN", `Failed to fetch forum questions: ${error.message}`);
    }
  }

  /**
   * Сканируем HTML файлы в директории
   */
  async _scanHtmlFiles(dirPath) {
    const files = [];

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".html")) {
          // Проверяем, не нужно ли игнорировать файл
          if (this._shouldIgnoreFile(entry.name)) {
            continue;
          }

          const filePath = path.join(dirPath, entry.name);
          const stats = await fs.stat(filePath);

          // Проверяем размер файла
          if (stats.size > this.config.htmlParsing.maxFileSize) {
            writeLog("WARN", `File too large, skipping: ${entry.name}`);
            continue;
          }

          files.push({
            name: entry.name,
            path: filePath,
            mtime: stats.mtime.toISOString().split("T")[0],
            size: stats.size,
          });
        }
      }
    } catch (error) {
      writeLog(
        "ERROR",
        `Failed to scan directory ${dirPath}: ${error.message}`
      );
    }

    return files;
  }

  /**
   * Проверяем, нужно ли игнорировать файл
   */
  _shouldIgnoreFile(filename) {
    return this.config.ignoreFiles.includes(filename);
  }

  /**
   * Генерируем XML для sitemap
   */
  _buildXmlSitemap(urls) {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml +=
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';

    for (const url of urls) {
      xml += "  <url>\n";
      xml += `    <loc>${this._escapeXml(url.loc)}</loc>\n`;

      if (url.lastmod) {
        xml += `    <lastmod>${url.lastmod}</lastmod>\n`;
      }

      if (url.changefreq) {
        xml += `    <changefreq>${url.changefreq}</changefreq>\n`;
      }

      if (url.priority) {
        xml += `    <priority>${url.priority}</priority>\n`;
      }
      xml += `    <xhtml:link rel="alternate" hreflang="sk" href="${this._escapeXml(
        url.loc
      )}" />\n`;
      xml += `    <xhtml:link rel="alternate" hreflang="sk-SK" href="${this._escapeXml(
        url.loc
      )}" />\n`;
      xml += "  </url>\n";
    }

    xml += "</urlset>";
    return xml;
  }

  /**
   * Экранируем XML символы
   */
  _escapeXml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  /**
   * Создаем backup старого sitemap
   */
  async _backupOldSitemap() {
    const sitemapPath = path.resolve(__dirname, this.config.paths.sitemapFile);

    try {
      // Проверяем, существует ли старый sitemap
      await fs.access(sitemapPath);

      // Создаем папку для backup'ов если не существует
      const backupDir = path.resolve(__dirname, this.config.paths.backupDir);
      await fs.mkdir(backupDir, { recursive: true });

      // Генерируем имя backup файла с timestamp
      const timestamp = new Date()
        .toISOString()
        .replace(/:/g, "-")
        .replace(/\./g, "-")
        .substring(0, 19); // YYYY-MM-DDTHH-mm-ss

      const backupFileName = `${timestamp}_sitemap.xml`;
      const backupPath = path.join(backupDir, backupFileName);

      // Копируем старый sitemap в backup
      await fs.copyFile(sitemapPath, backupPath);

      writeLog("INFO", `Created sitemap backup: ${backupFileName}`);
    } catch (error) {
      if (error.code !== "ENOENT") {
        // Игнорируем ошибку "файл не найден"
        writeLog("WARN", `Failed to create sitemap backup: ${error.message}`);
      }
    }
  }

  /**
   * Атомарная запись нового sitemap
   */
  async _writeNewSitemap(xml) {
    const sitemapPath = path.resolve(__dirname, this.config.paths.sitemapFile);
    const tempPath = `${sitemapPath}.tmp`;

    try {
      // Записываем во временный файл
      await fs.writeFile(tempPath, xml, "utf8");

      // Атомарно переименовываем временный файл
      await fs.rename(tempPath, sitemapPath);

      writeLog("INFO", `New sitemap written: ${sitemapPath}`);
    } catch (error) {
      // Удаляем временный файл при ошибке
      try {
        await fs.unlink(tempPath);
      } catch (unlinkError) {
        // Игнорируем ошибку удаления
      }

      throw new Error(`Failed to write sitemap: ${error.message}`);
    }
  }

  /**
   * Удаляем старые backup'ы (старше retention дней)
   */
  async _cleanupOldBackups() {
    const backupDir = path.resolve(__dirname, this.config.paths.backupDir);
    const maxAge = this.config.backup.retentionDays * 24 * 60 * 60 * 1000; // в миллисекундах
    const now = Date.now();

    try {
      const files = await fs.readdir(backupDir);

      for (const file of files) {
        if (file.endsWith("_sitemap.xml")) {
          const filePath = path.join(backupDir, file);
          const stats = await fs.stat(filePath);

          if (now - stats.mtime.getTime() > maxAge) {
            await fs.unlink(filePath);
            writeLog("INFO", `Deleted old backup: ${file}`);
          }
        }
      }
    } catch (error) {
      writeLog("WARN", `Failed to cleanup old backups: ${error.message}`);
    }
  }
}

// Экспортируем синглтон
export const sitemapService = new SitemapService();
