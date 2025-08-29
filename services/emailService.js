// services/email.service.js
import axios from "axios";
import { microServices } from "../config/micro.js";
import { cryptoData, cryptoXAPIKey } from "../utils/crypto.js";

class EmailService {
  constructor() {
    this.baseUrl = microServices.email.baseUrl;
    this.apiKey = microServices.email.xApiKey;

    this.client = axios.create({
      baseURL: microServices.email.baseUrl,
      timeout: 10000,
    });

    // Interceptor для логирования
    this.client.interceptors.request.use(
      (config) => {
        console.log(
          `📧 Email Service Request: ${config.method?.toUpperCase()} ${
            config.url
          }`
        );
        console.log(`📧 Email data:`, {
          hasData: !!config.data?.data,
          dataLength: config.data?.data?.length || 0,
          timestamp: new Date().toISOString(),
        });
        return config;
      },
      (error) => {
        console.error("❌ Email Service Request Error:", error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        console.log(
          `✅ Email Service Response: ${response.status} ${response.config.url}`
        );
        console.log(`✅ Email sent:`, response.data?.status);
        return response;
      },
      (error) => {
        console.error(
          `❌ Email Service Error: ${error.response?.status || "NETWORK"} ${
            error.config?.url
          }`
        );
        console.error("Error details:", error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Отправка email через микросервис
   * @param {string} email - Email получателя
   * @param {string} type - Тип шаблона email
   * @param {string} companyName - Название компании для выбора шаблона
   * @param {object} customParams - Параметры для шаблона
   * @returns {Promise<object>} Результат отправки
   */
  async sendEmail(email, type, companyName, customParams = {}) {
    try {
      if (!email || !type || !companyName) {
        throw new Error("Missing required fields: email, type, companyName");
      }

      const response = await this.client.post(
        "/email/send",
        {
          data: cryptoData({ email, type, companyName, customParams }),
        },
        {
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "EmailService-Client/1.0",
            "X-API-Key": cryptoXAPIKey({
              apiKey: microServices.email.xApiKey,
              timestamp: Date.now(),
            }),
          },
        }
      );

      return {
        success: response.data.status,
        message: response.data.message,
        response: response.data.response,
      };
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message;
      console.error(`❌ Failed to send email to ${email}:`, errorMessage);

      throw new Error(`Email sending failed: ${errorMessage}`);
    }
  }
}

// Создание и экспорт экземпляра сервиса
const emailService = new EmailService();

export default emailService;
