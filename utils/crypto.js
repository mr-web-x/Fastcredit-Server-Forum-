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
