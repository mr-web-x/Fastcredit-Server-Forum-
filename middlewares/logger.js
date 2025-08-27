import fs from "fs";
import path from "path";

// Создаем папку logs если её нет
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Универсальная функция логирования
export const writeLog = (status, details) => {
  const timestamp = new Date().toISOString();
  const date = timestamp.split("T")[0]; // YYYY-MM-DD
  const logFile = path.join(logsDir, `${date}.log`);

  const logEntry = `${timestamp} [STATUS: ${status}] ${details}`;

  try {
    // Пишем в файл
    fs.appendFileSync(logFile, logEntry + "\n", "utf8");

    // И в консоль с цветом по статусу
    if (
      status.includes("ERROR") ||
      status.includes("500") ||
      status.includes("403")
    ) {
      console.error(`🔴 ${logEntry}`);
    } else if (status.includes("WARN") || status.includes("400")) {
      console.warn(`🟡 ${logEntry}`);
    } else {
      console.log(`🟢 ${logEntry}`);
    }
  } catch (err) {
    console.error("Failed to write log:", err.message);
  }
};

// Middleware для HTTP запросов
const logger = (req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;

    const clientIP = (
      req.ip ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      (req.headers["x-forwarded-for"] &&
        req.headers["x-forwarded-for"].split(",")[0]) ||
      req.headers["x-real-ip"] ||
      "unknown"
    ).replace(/^::ffff:/, "");

    const origin = req.headers.origin || req.headers.referer || "direct";
    const host = req.headers.host || "unknown";
    const userAgent = req.headers["user-agent"] || "unknown";

    const status = `${res.statusCode}`;
    const details = `FROM: ${clientIP} (${origin}) TO: ${host} | ${
      req.method
    } ${req.originalUrl} | TIME: ${duration}ms | UA: ${userAgent.substring(
      0,
      50
    )}`;

    writeLog(status, details);
  });

  next();
};

// Логирование действий пользователей
export const logUserAction = (userId, action, details = "") => {
  const userInfo = userId ? `User: ${userId}` : "Anonymous";
  writeLog("SUCCESS", `${userInfo} | Action: ${action} | ${details}`);
};

// Логирование ошибок
export const logError = (error, context = "", userId = null) => {
  const userInfo = userId ? `User: ${userId}` : "System";
  const errorDetails = `${userInfo} | Context: ${context} | Error: ${
    error.message
  } | Stack: ${error.stack?.substring(0, 200)}`;
  writeLog("ERROR", errorDetails);
};

// Логирование попыток несанкционированного доступа
export const logSecurityEvent = (type, details, userId = null, ip = null) => {
  const userInfo = userId ? `User: ${userId}` : "Anonymous";
  const ipInfo = ip ? `IP: ${ip}` : "";
  writeLog("WARN", `SECURITY: ${type} | ${userInfo} ${ipInfo} | ${details}`);
};

// Логирование изменений ролей
export const logRoleChange = (targetUserId, oldRole, newRole, adminId) => {
  writeLog(
    "SUCCESS",
    `ROLE_CHANGE: Admin ${adminId} changed role for User ${targetUserId}: ${oldRole} → ${newRole}`
  );
};

export default logger;
