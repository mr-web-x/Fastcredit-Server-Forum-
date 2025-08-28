// utils/security.js
import crypto from "crypto";
import bcrypt from "bcrypt";

export const hashPassword = async (password) => {
  return await bcrypt.hash(password, 12);
};

export const comparePassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

export const generateSecureToken = (length = 32) => {
  return crypto.randomBytes(length).toString("hex");
};

export const sanitizeInput = (input) => {
  if (typeof input !== "string") return input;
  return input.trim().replace(/[<>]/g, "");
};

export default {
  hashPassword,
  comparePassword,
  generateSecureToken,
  sanitizeInput,
};
