import mongoose from "mongoose";
import EncryptableService from "../services/encryptableService.js";

const socialTokenSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    access_token: { type: String, required: true },
    access_token_expires_at: { type: Date, required: false },
    refresh_token: { type: String, required: false },
    refresh_token_expires_at: { type: Date, required: false },
  },
  { timestamps: true }
);

EncryptableService.applyEncryption(socialTokenSchema, [
  "access_token",
  "refresh_token",
]);

const SocialToken = mongoose.model("SocialToken", socialTokenSchema);

export default SocialToken;
