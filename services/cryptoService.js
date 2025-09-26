// services/cryptoService.js
import axios from "axios";
import { microServices } from "../config/micro.js";
import { cryptoXAPIKey } from "../utils/crypto.js";

class CryptoService {
  constructor() {
    this.baseUrl = microServices.crypto.baseUrl;
    this.apiKey = microServices.crypto.xApiKey;

    this.client = axios.create({
      baseURL: microServices.crypto.baseUrl,
      timeout: 15000, // 15 секунд (crypto операции могут быть медленными)
    });

    // Interceptor для логирования
    this.client.interceptors.request.use(
      (config) => {
        return config;
      },
      (error) => {
        console.error("❌ Crypto Service Request Error:", error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        console.log(
          `✅ Crypto Service Response: ${response.status} ${response.config.url}`
        );
        console.log(`✅ Operation:`, {
          success: response.data?.success,
          operation: response.config.url?.split("/").pop(),
          responseTime: response.headers["x-response-time"] || "N/A",
        });
        return response;
      },
      (error) => {
        console.error(
          `❌ Crypto Service Error: ${error.response?.status || "NETWORK"} ${
            error.config?.url
          }`
        );
        console.error(
          "Error details:",
          error.response?.data || error.message || "none"
        );
        return Promise.reject(error);
      }
    );
  }

  /**
   * Создание зашифрованного токена для аутентификации
   * @returns {string} зашифрованный токен
   */
  createAuthToken() {
    try {
      const payload = {
        apiKey: this.apiKey,
        timestamp: Date.now(),
      };
      return cryptoXAPIKey(payload); // Используем локальную функцию для токена
    } catch (error) {
      throw new Error(`Failed to create auth token: ${error.message}`);
    }
  }

  /**
   * Базовый метод для HTTP запросов с аутентификацией
   * @param {string} endpoint - API endpoint
   * @param {object} data - данные запроса
   * @returns {Promise<object>} ответ сервера
   */
  async makeRequest(endpoint, data) {
    try {
      const authToken = this.createAuthToken();

      const response = await this.client.post(endpoint, data, {
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "CryptoService-Client/1.0",
          "x-api-key": authToken, // ✅ Свежий токен для каждого запроса
        },
      });

      if (!response.data.success) {
        throw new Error(response.data.error || "Unknown crypto service error");
      }

      return response.data;
    } catch (error) {
      const errorMessage = error.response?.data?.error || error.message;
      console.error(`❌ Crypto Service ${endpoint} failed:`, errorMessage);
      throw new Error(`Crypto operation failed: ${errorMessage}`);
    }
  }

  // ===========================================
  // ОСНОВНЫЕ МЕТОДЫ (совместимые с старыми функциями)
  // ===========================================

  /**
   * Шифрование данных (аналог cryptoData)
   * ОБНОВЛЕНО: Поддерживает строки и объекты
   * @param {string|object} data - данные для шифрования
   * @returns {Promise<string|object>} зашифрованная строка или объект
   */
  async cryptoData(data) {
    try {
      // Убрали жесткую проверку типов - пусть крипто-сервис валидирует
      if (data === null || data === undefined) {
        throw new Error("data cannot be null or undefined");
      }

      const response = await this.makeRequest("/api/crypto/encrypt", { data });
      return response.encrypted;
    } catch (error) {
      console.error("❌ cryptoData failed:", error.message);
      throw error;
    }
  }

  /**
   * Расшифровка данных (аналог decryptData)
   * ОБНОВЛЕНО: Поддерживает строки и объекты
   * @param {string|object} encryptedData - зашифрованные данные
   * @returns {Promise<string|object>} расшифрованные данные
   */
  async decryptData(encryptedData) {
    try {
      // Убрали жесткую проверку на строку - пусть крипто-сервис валидирует
      if (encryptedData === null || encryptedData === undefined) {
        throw new Error("encryptedData cannot be null or undefined");
      }

      if (typeof encryptedData === "string") {
        const result = await this.makeRequest("/api/crypto/decrypt", {
          encryptedData: { single_field: encryptedData },
        });
        return result.data.single_field;
      }

      const response = await this.makeRequest("/api/crypto/decrypt", {
        encryptedData,
      });
      return response.data;
    } catch (error) {
      console.error("❌ decryptData failed:", error.message);
      throw error;
    }
  }

  /**
   * Хеширование данных (аналог hashData) - БЕЗ ИЗМЕНЕНИЙ
   * @param {string} data - данные для хеширования
   * @returns {Promise<string>} хеш в виде hex строки
   */
  async hashData(data) {
    try {
      if (!data || typeof data !== "string") {
        throw new Error("data must be a non-empty string");
      }

      const response = await this.makeRequest("/api/crypto/hash", { data });
      return response.hash;
    } catch (error) {
      console.error("❌ hashData failed:", error.message);
      throw error;
    }
  }

  // ===========================================
  // ДОПОЛНИТЕЛЬНЫЕ МЕТОДЫ (БЕЗ ИЗМЕНЕНИЙ)
  // ===========================================

  smartDecrypt = async (dataToDecrypt) => {
    try {
      if (!dataToDecrypt) return;

      // Если это массив
      if (Array.isArray(dataToDecrypt)) {
        await Promise.all(
          dataToDecrypt.map(async (el) => {
            try {
              await this.smartDecrypt(el);
            } catch (err) {
              console.warn("[smartDecrypt] Skip array element:", err.message);
            }
          })
        );
        return;
      }

      // Если это mongoose-документ
      if (dataToDecrypt._doc) {
        try {
          if (typeof dataToDecrypt.decrypt === "function") {
            await dataToDecrypt.decrypt();
          }
        } catch (err) {
          console.warn("[smartDecrypt] Skip mongoose decrypt:", err.message);
        }

        await Promise.all(
          Object.entries(dataToDecrypt._doc).map(async ([key, val]) => {
            try {
              await this.smartDecrypt(val);
            } catch (err) {
              console.warn(`[smartDecrypt] Skip field "${key}":`, err.message);
            }
          })
        );
        return;
      }

      // Если это plain object
      if (typeof dataToDecrypt === "object" && dataToDecrypt !== null) {
        await Promise.all(
          Object.entries(dataToDecrypt).map(async ([key, val]) => {
            try {
              await this.smartDecrypt(val);
            } catch (err) {
              console.warn(
                `[smartDecrypt] Skip object field "${key}":`,
                err.message
              );
            }
          })
        );
        return;
      }

      // Для строк/чисел/null/undefined — ничего не делаем
    } catch (error) {
      console.error("[smartDecrypt] Unexpected error:", error.message);
    }
  };

  /**
   * Проверка хеша
   * @param {string} data - исходные данные
   * @param {string} hash - хеш для проверки
   * @returns {Promise<boolean>} результат проверки
   */
  async verifyHash(data, hash) {
    try {
      if (
        !data ||
        typeof data !== "string" ||
        !hash ||
        typeof hash !== "string"
      ) {
        throw new Error("data and hash must be non-empty strings");
      }

      const response = await this.makeRequest("/api/crypto/verify-hash", {
        data,
        hash,
      });
      return response.valid;
    } catch (error) {
      console.error("❌ verifyHash failed:", error.message);
      throw error;
    }
  }

  /**
   * Создание JWT токена
   * @param {object} payload - данные токена
   * @param {string} expiresIn - время жизни (опционально)
   * @returns {Promise<object>} объект с токеном и информацией
   */
  async signJWT(payload, expiresIn = null) {
    try {
      if (!payload || typeof payload !== "object") {
        throw new Error("payload must be an object");
      }

      const requestData = { payload };
      if (expiresIn) {
        requestData.expiresIn = expiresIn;
      }

      const response = await this.makeRequest("/api/jwt/sign", requestData);
      return {
        token: response.token,
        expiresAt: response.expiresAt,
        ttl: response.ttl,
      };
    } catch (error) {
      console.error("❌ signJWT failed:", error.message);
      throw error;
    }
  }

  /**
   * Проверка JWT токена (с TTL для кеширования!)
   * @param {string} token - JWT токен
   * @returns {Promise<object>} результат проверки с TTL
   */
  async verifyJWT(token) {
    try {
      if (!token || typeof token !== "string") {
        throw new Error("token must be a non-empty string");
      }

      const response = await this.makeRequest("/api/jwt/verify", { token });
      return {
        valid: response.valid,
        payload: response.payload,
        expiresAt: response.expiresAt,
        ttl: response.ttl,
        error: response.error,
      };
    } catch (error) {
      console.error("❌ verifyJWT failed:", error.message);
      // Возвращаем invalid результат вместо throw для совместимости
      return {
        valid: false,
        payload: null,
        expiresAt: null,
        ttl: 0,
        error: error.message,
      };
    }
  }

  /**
   * Обновление JWT токена
   * @param {string} token - старый токен
   * @param {string} expiresIn - время жизни нового токена (опционально)
   * @returns {Promise<object>} новый токен с информацией
   */
  async refreshJWT(token, expiresIn = null) {
    try {
      if (!token || typeof token !== "string") {
        throw new Error("token must be a non-empty string");
      }

      const requestData = { token };
      if (expiresIn) {
        requestData.expiresIn = expiresIn;
      }

      const response = await this.makeRequest("/api/jwt/refresh", requestData);
      return {
        token: response.token,
        expiresAt: response.expiresAt,
        ttl: response.ttl,
      };
    } catch (error) {
      console.error("❌ refreshJWT failed:", error.message);
      throw error;
    }
  }

  // ===========================================
  // СЛУЖЕБНЫЕ МЕТОДЫ (БЕЗ ИЗМЕНЕНИЙ)
  // ===========================================

  /**
   * Проверка работоспособности криптосервиса
   * @returns {Promise<object>} статус сервиса
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${this.baseUrl}/health`, {
        timeout: 5000,
      });
      return response.data;
    } catch (error) {
      console.error("❌ Crypto Service health check failed:", error.message);
      return {
        success: false,
        status: "unhealthy",
        error: error.message,
      };
    }
  }

  /**
   * Получение информации о сервисе
   * @returns {Promise<object>} информация о endpoints
   */
  async getServiceInfo() {
    try {
      const response = await axios.get(`${this.baseUrl}/`, {
        timeout: 5000,
      });
      return response.data;
    } catch (error) {
      console.error("❌ Failed to get crypto service info:", error.message);
      throw error;
    }
  }
}

// Создание и экспорт экземпляра сервиса
const cryptoService = new CryptoService();

export default cryptoService;
