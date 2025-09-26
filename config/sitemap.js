// config/sitemap.config.js

export const sitemapConfig = {
  // Основной домен
  siteUrl: "https://fastcredit.sk",

  // Пути к файлам и директориям
  paths: {
    // Путь к корню статического сайта (из /main/servers/root/)
    clientsRoot: "../../../clients/root",
    // Путь к результирующему sitemap.xml
    sitemapFile: "../../../clients/root/sitemap.xml",
    // Папка для backup'ов sitemap
    backupDir: "../backups/sitemap",
    // Папка с HTML статьями блога
    blogDir: "../../../clients/root/blog",
    // Папка с HTML статьями про кредиты
    typyPoziciekDir: "../../../clients/root/typy-poziciek",
  },

  // СТАТИЧЕСКИЕ СТРАНИЦЫ (дата НЕ меняется автоматически)
  staticPages: [
    {
      path: "/game.html",
      priority: 0.6,
      changeFreq: "yearly",
      lastModified: "2024-01-15",
    },
    {
      path: "/caste-otazky.html",
      priority: 0.9,
      changeFreq: "monthly",
      lastModified: "2024-01-15",
    },
    {
      path: "/kontakty.html",
      priority: 0.9,
      changeFreq: "monthly",
      lastModified: "2024-01-15",
    },
    {
      path: "/rychla-pozicka.html",
      priority: 0.9,
      changeFreq: "monthly",
      lastModified: "2024-01-15",
    },
    {
      path: "/forum/login",
      priority: 0.6,
      changeFreq: "yearly",
      lastModified: "2024-01-10",
    },
    {
      path: "/forum/register",
      priority: 0.6,
      changeFreq: "yearly",
      lastModified: "2024-01-10",
    },
    {
      path: "/forum/forgot-password",
      priority: 0.5,
      changeFreq: "yearly",
      lastModified: "2024-01-10",
    },
  ],

  // ОТСЛЕЖИВАЕМЫЕ ФАЙЛЫ (используют mtime для lastModified)
  watchedFiles: [
    {
      // Словник - отслеживаем изменения файла
      filePath: "../../../clients/root/slovnik.html",
      url: "/slovnik.html",
      priority: 0.9,
      changeFreq: "daily",
      // Какие родительские страницы обновить при изменении этого файла
      updateParents: ["/"],
    },
  ],

  // ДИНАМИЧЕСКИЕ РОДИТЕЛЬСКИЕ СТРАНИЦЫ
  // Их lastModified обновляется при появлении новых дочерних страниц
  dynamicParents: [
    {
      path: "/",
      priority: 1.0,
      changeFreq: "daily",
      // Обновляется при новых: blog/*, typy-poziciek/*, forum/questions/*, slovnik.html
      triggers: ["blog", "typyPoziciek", "forumQuestions", "watchedFiles"],
    },
    {
      path: "/blog.html",
      priority: 0.9,
      changeFreq: "daily",
      // Обновляется при новых blog/*
      triggers: ["blog"],
    },
    {
      path: "/typy-poziciek.html",
      priority: 0.9,
      changeFreq: "weekly",
      // Обновляется при новых typy-poziciek/*
      triggers: ["typyPoziciek"],
    },
    {
      path: "/forum",
      priority: 0.9,
      changeFreq: "daily",
      // Обновляется при новых forum/questions/*
      triggers: ["forumQuestions"],
    },
    {
      path: "/forum/questions",
      priority: 0.8,
      changeFreq: "daily",
      // Обновляется при новых forum/questions/*
      triggers: ["forumQuestions"],
    },
  ],

  // Файлы, которые нужно игнорировать при сканировании
  ignoreFiles: ["ПРИМЕР ФАСТКРЕДИТ.html"],

  // Приоритеты для разных типов контента
  priorities: {
    watchedFiles: 0.9, // Отслеживаемые файлы (slovnik.html)
    dynamicParent: 0.9, // Родительские страницы (blog.html, typy-poziciek.html)
    blog: 0.8, // Статьи блога (blog/*)
    typyPoziciek: 0.8, // Статьи про кредиты (typy-poziciek/*)
    forumQuestions: 0.7, // Вопросы форума (forum/questions/*)
    static: 0.6, // Статические страницы (game.html и т.д.)
  },

  // Частота изменений для разных типов контента
  changeFrequencies: {
    watchedFiles: "daily", // Отслеживаемые файлы
    dynamicParent: "daily", // Родительские могут обновляться часто
    blog: "weekly", // Статьи блога
    typyPoziciek: "monthly", // Статьи про кредиты
    forumQuestions: "daily", // Вопросы форума
    static: "monthly", // Статические страницы редко меняются
  },

  // Настройки cron задачи
  cron: {
    // Каждые 8 часов: 00:00, 08:00, 16:00
    schedule: "0 */8 * * *",
    timezone: "Europe/Bratislava",
    // Запускать сразу при старте сервера
    runOnStart: false,
  },

  // Настройки backup'ов
  backup: {
    // Сколько дней хранить backup'ы
    retentionDays: 10,
    // Формат имени файла backup'а
    filenameFormat: "YYYY-MM-DD_HH-mm-ss_sitemap.xml",
  },

  // Настройки для парсинга HTML файлов
  htmlParsing: {
    // Кодировка файлов
    encoding: "utf8",
    // Максимальный размер файла для парсинга (в байтах)
    maxFileSize: 1024 * 1024, // 1MB
    // Мета-теги для извлечения
    metaTags: {
      title: "title",
      description: 'meta[name="description"]',
      keywords: 'meta[name="keywords"]',
      lastModified: 'meta[name="last-modified"]',
    },
  },

  // Ограничения для sitemap
  limits: {
    // Максимальное количество URL в sitemap
    maxUrls: 50000,
    // Максимальная длина URL
    maxUrlLength: 2048,
  },

  // Настройки логирования
  logging: {
    // Логировать подробности работы
    verbose: true,
    // Логировать каждый добавленный URL
    logUrls: false,
  },
};
