// routes/index.js
import express from "express";

// Импорт всех роутов
import authRoutes from "./auth.js";
import questionRoutes from "./questions.js";
import answerRoutes from "./answers.js";
import commentRoutes from "./comments.js";
import userRoutes from "./users.js";
import expertRoutes from "./experts.js";
import adminRoutes from "./admin.js";
import reportRoutes from "./reports.js";
import testRoutes from "./test.js";

const router = express.Router();

// Подключение роутов с базовыми путями
router.use("/auth", authRoutes);
router.use("/questions", questionRoutes);
router.use("/answers", answerRoutes);
router.use("/comments", commentRoutes);
router.use("/users", userRoutes);
router.use("/experts", expertRoutes);
router.use("/admin", adminRoutes);
router.use("/reports", reportRoutes);
router.use("/test", testRoutes);

// if (process.env.NODE_ENV === "development") {
// }

// API информация
router.get("/", (req, res) => {
  res.json({
    message: "QA Forum API v1.0",
    version: "1.0.0",
    endpoints: {
      auth: "/api/auth",
      questions: "/api/questions",
      answers: "/api/answers",
      comments: "/api/comments",
      users: "/api/users",
      experts: "/api/experts",
      admin: "/api/admin",
      reports: "/api/reports",
    },
    documentation: "https://docs.fastcredit.sk/forum-api",
    status: "active",
  });
});

export default router;
