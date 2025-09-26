// routes/test.js
import express from "express";
import { socialService } from "../services/socialService.js";
import SocialToken from "../models/SocialToken.js";
import cryptoService from "../services/cryptoService.js";

const router = express.Router();

router.post("/facebook/publish", async (req, res) => {
  try {
    const { body } = req;

    await socialService.facebookPublishPost(body.content);

    res.send({ status: true, message: "Post was published" });
  } catch (error) {
    res.send({ status: false, message: error.message });
  }
});

router.post("/linkedin/publish", async (req, res) => {
  try {
    const { body } = req;

    await socialService.linkedinPublishPost(body.content, "Title", "some-url");

    res.send({ status: true, message: "Post was published" });
  } catch (error) {
    res.send({ status: false, message: error.message });
  }
});

router.post("/social/tokens", async (req, res) => {
  try {
    const {
      provider,
      access_token,
      access_token_expires_at,
      refresh_token,
      refresh_token_expires_at,
    } = req.body;

    const token = new SocialToken({
      provider,
      access_token,
      access_token_expires_at: access_token_expires_at
        ? new Date(access_token_expires_at)
        : null,
      refresh_token,
      refresh_token_expires_at: refresh_token_expires_at
        ? new Date(refresh_token_expires_at)
        : null,
    });

    await token.save();
    res.json({ status: true, token });
  } catch (err) {
    res.status(500).json({ status: false, message: err.message });
  }
});

router.post("/hash", async (req, res) => {
  try {
    const { body } = req;

    console.log(body.data);

    const result1 = await cryptoService.hashData(body.data);

    console.log("/hash", result1);

    const result2 = await cryptoService.hashData(body.data);

    console.log("/hash", result2);

    const isSameResult = result1 === result2;

    console.log(isSameResult);

    res.send({
      status: true,
      message: "Data was hashed",
      result1,
      result2,
      isSameResult,
    });
  } catch (error) {
    res.send({ status: false, message: error.message });
  }
});

export default router;
