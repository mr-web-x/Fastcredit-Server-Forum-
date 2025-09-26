import CryptoJS from "crypto-js";
import dotenv from "dotenv";
dotenv.config();

export function cryptoData(data) {
  const encryptedData = CryptoJS.AES.encrypt(
    JSON.stringify(data),
    process.env.SECRET_FRONT_KEY
  ).toString();
  return encryptedData;
}

export function cryptoXAPIKey(data) {
  const encryptedData = CryptoJS.AES.encrypt(
    JSON.stringify(data),
    process.env.SECRET_X_API_KEY
  ).toString();
  return encryptedData;
}

export function hashData(data) {
  // Создаем HMAC с использованием SHA-256
  const hash = CryptoJS.HmacSHA256(data, process.env.SECRET_HASH);
  // Возвращаем хешированное значение в виде строки
  return hash.toString(CryptoJS.enc.Hex);
}
