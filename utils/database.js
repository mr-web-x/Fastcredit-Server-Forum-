import mongoose from "mongoose";
import config from "../config/index.js";
import { writeLog } from "../middlewares/logger.js";

class Database {
  constructor() {
    this.connection = null;
  }

  async connect() {
    try {
      // Настройки подключения
      const options = {
        maxPoolSize: 10, // максимум подключений в пуле
        serverSelectionTimeoutMS: 5000, // таймаут выбора сервера
        socketTimeoutMS: 45000, // таймаут сокета
      };

      this.connection = await mongoose.connect(config.MONGODB_URI, options);

      writeLog(
        "SUCCESS",
        `MongoDB connected: ${this.connection.connection.host}:${this.connection.connection.port}/${this.connection.connection.name}`
      );

      // Обработка событий подключения
      mongoose.connection.on("error", (error) => {
        writeLog("ERROR", `MongoDB connection error: ${error.message}`);
      });

      mongoose.connection.on("disconnected", () => {
        writeLog("WARN", "MongoDB disconnected");
      });

      mongoose.connection.on("reconnected", () => {
        writeLog("INFO", "MongoDB reconnected");
      });

      // Graceful shutdown
      process.on("SIGINT", () => {
        this.disconnect();
      });

      return this.connection;
    } catch (error) {
      writeLog("ERROR", `MongoDB connection failed: ${error.message}`);
      process.exit(1);
    }
  }

  async disconnect() {
    try {
      if (this.connection) {
        await mongoose.connection.close();
        writeLog("INFO", "MongoDB connection closed through app termination");
        process.exit(0);
      }
    } catch (error) {
      writeLog("ERROR", `Error during MongoDB disconnection: ${error.message}`);
      process.exit(1);
    }
  }

  // Проверка подключения
  isConnected() {
    return mongoose.connection.readyState === 1;
  }

  // Получение статистики подключения
  getConnectionInfo() {
    if (this.isConnected()) {
      return {
        host: mongoose.connection.host,
        port: mongoose.connection.port,
        name: mongoose.connection.name,
        readyState: mongoose.connection.readyState,
        collections: Object.keys(mongoose.connection.collections),
      };
    }
    return null;
  }
}

export default new Database();
