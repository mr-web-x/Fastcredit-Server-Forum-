import dotenv from "dotenv";
dotenv.config();

export const microServices = {
  email: {
    xApiKey: process.env.EMAIL_SERVICE_X_API_KEY,
    baseUrl: "https://email.walletroom.online",
  },
  telegram: {
    xApiKey: process.env.TG_SERVICE_X_API_KEY,
    baseUrl: "https://telegram.walletroom.online",
  },
};
