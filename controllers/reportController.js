// controllers/reportController.js
import Report from "../models/Report.js";
import notificationService from "../services/notificationService.js";
import {
  formatResponse,
  getPaginationData,
  isValidObjectId,
  createPaginationResponse,
} from "../utils/helpers.js";
import {
  REPORT_TARGET_TYPES,
  REPORT_REASONS,
  REPORT_STATUS,
} from "../utils/constants.js";
import { asyncHandler } from "../middlewares/errorHandler.js";
import { logUserAction } from "../middlewares/logger.js";

class ReportController {
  // Создание жалобы
  createReport = asyncHandler(async (req, res) => {
    const { targetId, targetType, reason, description } = req.body;
    const reportedBy = req.user._id;

    // Валидация targetId
    if (!targetId || !isValidObjectId(targetId)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID объекта жалобы", {
          type: "VALIDATION_ERROR",
          field: "targetId",
        })
      );
    }

    // Валидация targetType
    if (
      !targetType ||
      !Object.values(REPORT_TARGET_TYPES).includes(targetType)
    ) {
      return res.status(400).json(
        formatResponse(false, null, "Недопустимый тип объекта", {
          type: "VALIDATION_ERROR",
          field: "targetType",
          allowedValues: Object.values(REPORT_TARGET_TYPES),
        })
      );
    }

    // Валидация reason
    if (!reason || !Object.values(REPORT_REASONS).includes(reason)) {
      return res.status(400).json(
        formatResponse(false, null, "Недопустимая причина жалобы", {
          type: "VALIDATION_ERROR",
          field: "reason",
          allowedValues: Object.values(REPORT_REASONS),
        })
      );
    }

    // Валидация description (опционально)
    if (description && description.length > 1000) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Описание не может превышать 1000 символов",
          {
            type: "VALIDATION_ERROR",
            field: "description",
          }
        )
      );
    }

    // Проверка на дублирование жалобы
    const existingReport = await Report.checkDuplicate(
      reportedBy,
      targetId,
      targetType
    );
    if (existingReport) {
      return res.status(409).json(
        formatResponse(false, null, "Вы уже подавали жалобу на этот объект", {
          type: "DUPLICATE_REPORT",
        })
      );
    }

    // Создание жалобы
    const report = new Report({
      reportedBy,
      targetId,
      targetType,
      reason,
      description: description?.trim() || null,
      status: REPORT_STATUS.PENDING,
    });

    await report.save();

    // Загружаем жалобу с населением полей
    const populatedReport = await Report.findById(report._id)
      .populate("reportedBy", "email role")
      .populate("targetId");

    // Уведомляем админов о новой жалобе
    try {
      await notificationService.notifyAdminsAboutReport(
        report._id,
        targetType,
        targetId,
        reason
      );
    } catch (notificationError) {
      console.warn(
        "Failed to notify admins about report:",
        notificationError.message
      );
    }

    logUserAction(
      reportedBy,
      "REPORT_CREATED",
      `Created report for ${targetType} ${targetId}: ${reason}`
    );

    res
      .status(201)
      .json(formatResponse(true, populatedReport, "Жалоба успешно подана"));
  });

  // Получение жалоб пользователя
  getMyReports = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);
    const userId = req.user._id;

    const [reports, total] = await Promise.all([
      Report.findByReporter(userId)
        .skip((page - 1) * limit)
        .limit(limit),
      Report.countDocuments({ reportedBy: userId }),
    ]);

    const paginatedResponse = createPaginationResponse(
      reports,
      total,
      page,
      limit
    );

    res.json(formatResponse(true, paginatedResponse, "Мои жалобы получены"));
  });

  // Получение всех жалоб (только админы)
  getAllReports = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);
    const { status, reason, targetType } = req.query;

    const query = {};
    if (status && Object.values(REPORT_STATUS).includes(status)) {
      query.status = status;
    }
    if (reason && Object.values(REPORT_REASONS).includes(reason)) {
      query.reason = reason;
    }
    if (targetType && Object.values(REPORT_TARGET_TYPES).includes(targetType)) {
      query.targetType = targetType;
    }

    const [reports, total] = await Promise.all([
      Report.find(query)
        .populate("reportedBy", "email role")
        .populate("reviewedBy", "email role")
        .populate("targetId")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Report.countDocuments(query),
    ]);

    const paginatedResponse = createPaginationResponse(
      reports,
      total,
      page,
      limit
    );

    res.json(formatResponse(true, paginatedResponse, "Все жалобы получены"));
  });

  // Получение жалоб в ожидании (только админы)
  getPendingReports = asyncHandler(async (req, res) => {
    const { page, limit } = getPaginationData(req);

    const [reports, total] = await Promise.all([
      Report.findPending()
        .skip((page - 1) * limit)
        .limit(limit),
      Report.countDocuments({ status: REPORT_STATUS.PENDING }),
    ]);

    const paginatedResponse = createPaginationResponse(
      reports,
      total,
      page,
      limit
    );

    res.json(
      formatResponse(true, paginatedResponse, "Жалобы в ожидании получены")
    );
  });

  // Получение жалоб на конкретный объект
  getReportsForTarget = asyncHandler(async (req, res) => {
    const { targetId, targetType } = req.params;

    // Валидация targetId
    if (!isValidObjectId(targetId)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID объекта", {
          type: "VALIDATION_ERROR",
          field: "targetId",
        })
      );
    }

    // Валидация targetType
    if (!Object.values(REPORT_TARGET_TYPES).includes(targetType)) {
      return res.status(400).json(
        formatResponse(false, null, "Недопустимый тип объекта", {
          type: "VALIDATION_ERROR",
          field: "targetType",
          allowedValues: Object.values(REPORT_TARGET_TYPES),
        })
      );
    }

    const reports = await Report.findByTarget(targetId, targetType);

    res.json(formatResponse(true, reports, "Жалобы на объект получены"));
  });

  // Рассмотрение жалобы (только админы)
  reviewReport = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { comment } = req.body;
    const adminId = req.user._id;

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID жалобы", {
          type: "VALIDATION_ERROR",
          field: "id",
        })
      );
    }

    const report = await Report.findById(id);
    if (!report) {
      return res
        .status(404)
        .json(formatResponse(false, null, "Жалоба не найдена"));
    }

    if (report.status !== REPORT_STATUS.PENDING) {
      return res.status(400).json(
        formatResponse(false, null, "Жалоба уже рассмотрена", {
          type: "REPORT_ALREADY_REVIEWED",
        })
      );
    }

    // Отмечаем жалобу как рассмотренную
    const reviewedReport = await report.markAsReviewed(adminId, comment);

    logUserAction(
      adminId,
      "REPORT_REVIEWED",
      `Reviewed report ${id}: ${report.reason} for ${report.targetType}`
    );

    res.json(
      formatResponse(true, reviewedReport, "Жалоба отмечена как рассмотренная")
    );
  });

  // Разрешение жалобы с принятием мер (только админы)
  resolveReport = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { actionTaken, comment } = req.body;
    const adminId = req.user._id;

    // Валидация ID
    if (!isValidObjectId(id)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID жалобы", {
          type: "VALIDATION_ERROR",
          field: "id",
        })
      );
    }

    // Валидация actionTaken
    if (!actionTaken || actionTaken.trim().length < 5) {
      return res.status(400).json(
        formatResponse(
          false,
          null,
          "Описание принятых мер должно содержать минимум 5 символов",
          {
            type: "VALIDATION_ERROR",
            field: "actionTaken",
          }
        )
      );
    }

    const report = await Report.findById(id);
    if (!report) {
      return res
        .status(404)
        .json(formatResponse(false, null, "Жалоба не найдена"));
    }

    // Разрешаем жалобу
    const resolvedReport = await report.resolve(
      adminId,
      actionTaken.trim(),
      comment
    );

    logUserAction(
      adminId,
      "REPORT_RESOLVED",
      `Resolved report ${id} with action: ${actionTaken.trim()}`
    );

    res.json(formatResponse(true, resolvedReport, "Жалоба успешно разрешена"));
  });

  // Получение статистики жалоб (только админы)
  getReportStatistics = asyncHandler(async (req, res) => {
    const statistics = await Report.getStatistics();

    // Дополнительная статистика
    const mostReported = await Report.getMostReported(10);

    const fullStatistics = {
      ...statistics,
      mostReported,
      avgProcessingTimeHours: statistics.avgProcessingTimeMs
        ? (statistics.avgProcessingTimeMs / (1000 * 60 * 60)).toFixed(2)
        : 0,
    };

    res.json(formatResponse(true, fullStatistics, "Статистика жалоб получена"));
  });

  // Получение действий конкретного админа по жалобам
  getAdminReportActions = asyncHandler(async (req, res) => {
    const { adminId } = req.params;
    const { page, limit } = getPaginationData(req);

    // Валидация adminId
    if (!isValidObjectId(adminId)) {
      return res.status(400).json(
        formatResponse(false, null, "Неверный формат ID администратора", {
          type: "VALIDATION_ERROR",
          field: "adminId",
        })
      );
    }

    // Админы могут смотреть только свои действия, кроме супер-админов
    if (adminId !== req.user._id.toString() && req.user.role !== "admin") {
      return res
        .status(403)
        .json(formatResponse(false, null, "Недостаточно прав доступа"));
    }

    const [reports, total] = await Promise.all([
      Report.findByAdmin(adminId)
        .skip((page - 1) * limit)
        .limit(limit),
      Report.countDocuments({ reviewedBy: adminId }),
    ]);

    const paginatedResponse = createPaginationResponse(
      reports,
      total,
      page,
      limit
    );

    res.json(
      formatResponse(
        true,
        paginatedResponse,
        "Действия администратора по жалобам получены"
      )
    );
  });
}

export default new ReportController();
