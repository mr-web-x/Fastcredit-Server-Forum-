// routes/users.js
import express from "express";
import userController from "../controllers/userController.js";
import { authenticate, requireAdmin } from "../middlewares/auth.js";
import {
  validateProfileUpdate,
  validateRoleChange,
  validateUserBan,
  validateSearch,
  validatePagination,
  validateObjectId,
} from "../middlewares/validation.js";
import {
  checkUserBan,
  checkUserCanPerformAction,
} from "../middlewares/banCheck.js";

const router = express.Router();

// GET /api/users - список пользователей (только админы)
router.get(
  "/",
  authenticate,
  checkUserBan,
  requireAdmin,
  validatePagination,
  userController.getUsers
);

// GET /api/users/search - поиск пользователей (только админы)
router.get(
  "/search",
  authenticate,
  checkUserBan,
  requireAdmin,
  validateSearch,
  validatePagination,
  userController.searchUsers
);

// GET /api/users/statistics - статистика пользователей (только админы)
router.get(
  "/statistics",
  authenticate,
  checkUserBan,
  requireAdmin,
  userController.getUserStatistics
);

// GET /api/users/expert-candidates - кандидаты в эксперты (только админы)
router.get(
  "/expert-candidates",
  authenticate,
  checkUserBan,
  requireAdmin,
  validatePagination,
  userController.getExpertCandidates
);

// POST /api/users/promote-experts - массовое назначение экспертов (только админы)
router.post(
  "/promote-experts",
  authenticate,
  checkUserBan,
  requireAdmin,
  userController.promoteUsersToExpert
);

// GET /api/users/:id - получение пользователя
router.get(
  "/:id",
  authenticate,
  checkUserBan,
  validateObjectId("id"),
  userController.getUser
);

// GET /api/users/:id/activity - активность пользователя
router.get(
  "/:id/activity",
  authenticate,
  checkUserBan,
  validateObjectId("id"),
  validatePagination,
  userController.getUserActivity
);

// GET /api/users/:id/role-history - история изменений ролей
router.get(
  "/:id/role-history",
  authenticate,
  checkUserBan,
  requireAdmin,
  validateObjectId("id"),
  validatePagination,
  userController.getUserRoleHistory
);

// PUT /api/users/:id/profile - обновление профиля
router.put(
  "/:id/profile",
  authenticate,
  checkUserBan,
  checkUserCanPerformAction,
  validateObjectId("id"),
  validateProfileUpdate,
  userController.updateProfile
);

// PUT /api/users/:id/role - изменение роли (только админы)
router.put(
  "/:id/role",
  authenticate,
  checkUserBan,
  requireAdmin,
  validateObjectId("id"),
  validateRoleChange,
  userController.changeUserRole
);

// POST /api/users/:id/ban - бан пользователя (только админы)
router.post(
  "/:id/ban",
  authenticate,
  checkUserBan,
  requireAdmin,
  validateObjectId("id"),
  validateUserBan,
  userController.banUser
);

// POST /api/users/:id/unban - разбан пользователя (только админы)
router.post(
  "/:id/unban",
  authenticate,
  checkUserBan,
  requireAdmin,
  validateObjectId("id"),
  userController.unbanUser
);

export default router;
