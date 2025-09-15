// services/notificationService.js
import User from "../models/User.js";
import Question from "../models/Question.js";
import Answer from "../models/Answer.js";
import Comment from "../models/Comment.js";
import { USER_ROLES } from "../utils/constants.js";
import { logUserAction, logError } from "../middlewares/logger.js";

class NotificationService {
  // Уведомление экспертов о новом вопросе
  async notifyExpertsAboutNewQuestion(questionId) {
    try {
      const question = await Question.findById(questionId).populate(
        "author",
        "email"
      );

      if (!question) {
        throw new Error("Question not found");
      }

      // Получаем всех активных экспертов
      const experts = await User.find({
        role: { $in: [USER_ROLES.EXPERT, USER_ROLES.ADMIN] },
        isActive: true,
        isBanned: false,
      }).select("email");

      // В реальном проекте здесь было бы отправка email/push уведомлений
      // Пока что просто логируем
      const expertEmails = experts.map((expert) => expert.email);

      logUserAction(
        null,
        "EXPERTS_NOTIFIED_NEW_QUESTION",
        `Notified ${expertEmails.length} experts about new question: ${question.slug}`
      );

      // Возвращаем информацию для дальнейшей обработки
      return {
        questionId,
        questionTitle: question.title,
        questionSlug: question.slug,
        authorEmail: question.author.email,
        notifiedExperts: expertEmails.length,
        experts: expertEmails,
      };
    } catch (error) {
      logError(error, "NotificationService.notifyExpertsAboutNewQuestion");
      throw error;
    }
  }

  // Уведомление автора вопроса о новом ответе
  async notifyQuestionAuthorAboutAnswer(answerId) {
    try {
      const answer = await Answer.findById(answerId)
        .populate("questionId")
        .populate("expert", "firstName lastName email role avatar");

      if (!answer) {
        throw new Error("Answer not found");
      }

      const question = answer.questionId;
      const author = await User.findById(question.author).select("email");

      if (!author) {
        throw new Error("Question author not found");
      }

      // Не уведомляем, если эксперт отвечает на свой вопрос (хотя это и запрещено)
      if (author._id.toString() === answer.expert._id.toString()) {
        return null;
      }

      logUserAction(
        answer.expert._id,
        "AUTHOR_NOTIFIED_NEW_ANSWER",
        `Notified question author ${author.email} about new answer from ${answer.expert.email}`
      );

      return {
        authorEmail: author.email,
        questionTitle: question.title,
        questionSlug: question.slug,
        expertEmail: answer.expert.email,
        expertRole: answer.expert.role,
        answerPreview: answer.content.substring(0, 100) + "...",
      };
    } catch (error) {
      logError(error, "NotificationService.notifyQuestionAuthorAboutAnswer");
      throw error;
    }
  }

  // Уведомление эксперта об одобрении ответа
  async notifyExpertAboutAnswerApproval(answerId, isApproved) {
    try {
      const answer = await Answer.findById(answerId)
        .populate("questionId", "title slug")
        .populate("expert", "email")
        .populate("moderatedBy", "email");

      if (!answer) {
        throw new Error("Answer not found");
      }

      const status = isApproved ? "approved" : "rejected";
      const actionType = isApproved
        ? "EXPERT_NOTIFIED_ANSWER_APPROVED"
        : "EXPERT_NOTIFIED_ANSWER_REJECTED";

      logUserAction(
        answer.moderatedBy._id,
        actionType,
        `Notified expert ${answer.expert.email} about answer ${status} for question: ${answer.questionId.slug}`
      );

      return {
        expertEmail: answer.expert.email,
        questionTitle: answer.questionId.title,
        questionSlug: answer.questionId.slug,
        isApproved,
        moderatorEmail: answer.moderatedBy.email,
        moderationComment: answer.moderationComment,
      };
    } catch (error) {
      logError(error, "NotificationService.notifyExpertAboutAnswerApproval");
      throw error;
    }
  }

  // Уведомление эксперта о принятии ответа
  async notifyExpertAboutAnswerAcceptance(answerId) {
    try {
      const answer = await Answer.findById(answerId)
        .populate("questionId")
        .populate("expert", "email");

      if (!answer || !answer.isAccepted) {
        throw new Error("Answer not found or not accepted");
      }

      const question = answer.questionId;
      const author = await User.findById(question.author).select("email");

      logUserAction(
        question.author,
        "EXPERT_NOTIFIED_ANSWER_ACCEPTED",
        `Notified expert ${answer.expert.email} about answer acceptance for question: ${question.slug}`
      );

      return {
        expertEmail: answer.expert.email,
        questionTitle: question.title,
        questionSlug: question.slug,
        questionAuthorEmail: author.email,
      };
    } catch (error) {
      logError(error, "NotificationService.notifyExpertAboutAnswerAcceptance");
      throw error;
    }
  }

  // Уведомление пользователя об изменении роли
  async notifyUserAboutRoleChange(userId, oldRole, newRole, changedBy) {
    try {
      const [user, admin] = await Promise.all([
        User.findById(userId).select("email"),
        User.findById(changedBy).select("email"),
      ]);

      if (!user) {
        throw new Error("User not found");
      }

      logUserAction(
        changedBy,
        "USER_NOTIFIED_ROLE_CHANGE",
        `Notified user ${user.email} about role change from ${oldRole} to ${newRole}`
      );

      return {
        userEmail: user.email,
        oldRole,
        newRole,
        changedByEmail: admin?.email || "System",
        isPromotion: this._isRolePromotion(oldRole, newRole),
        isDemotion: this._isRoleDemotion(oldRole, newRole),
      };
    } catch (error) {
      logError(error, "NotificationService.notifyUserAboutRoleChange");
      throw error;
    }
  }

  // Уведомление пользователя о бане
  async notifyUserAboutBan(userId, reason, bannedUntil = null, bannedBy) {
    try {
      const [user, admin] = await Promise.all([
        User.findById(userId).select("email"),
        User.findById(bannedBy).select("email"),
      ]);

      if (!user) {
        throw new Error("User not found");
      }

      const isPermanent = !bannedUntil;
      const banDuration = isPermanent
        ? "permanent"
        : `until ${bannedUntil.toLocaleDateString()}`;

      logUserAction(
        bannedBy,
        "USER_NOTIFIED_BAN",
        `Notified user ${user.email} about ban (${banDuration}). Reason: ${reason}`
      );

      return {
        userEmail: user.email,
        reason,
        bannedUntil,
        isPermanent,
        bannedByEmail: admin?.email || "System",
      };
    } catch (error) {
      logError(error, "NotificationService.notifyUserAboutBan");
      throw error;
    }
  }

  // Уведомление администраторов о новой жалобе
  async notifyAdminsAboutReport(reportId, targetType, targetId, reason) {
    try {
      // Получаем всех активных админов
      const admins = await User.find({
        role: USER_ROLES.ADMIN,
        isActive: true,
        isBanned: false,
      }).select("email");

      const adminEmails = admins.map((admin) => admin.email);

      logUserAction(
        null,
        "ADMINS_NOTIFIED_NEW_REPORT",
        `Notified ${adminEmails.length} admins about new report (${reportId}) for ${targetType}: ${reason}`
      );

      return {
        reportId,
        targetType,
        targetId,
        reason,
        notifiedAdmins: adminEmails.length,
        adminEmails,
      };
    } catch (error) {
      logError(error, "NotificationService.notifyAdminsAboutReport");
      throw error;
    }
  }

  // Массовое уведомление пользователей
  async notifyUsers(userIds, notificationType, data) {
    try {
      const users = await User.find({
        _id: { $in: userIds },
        isActive: true,
        isBanned: false,
      }).select("email");

      const userEmails = users.map((user) => user.email);

      logUserAction(
        null,
        "MASS_NOTIFICATION_SENT",
        `Sent mass notification (${notificationType}) to ${userEmails.length} users`
      );

      return {
        notificationType,
        data,
        notifiedUsers: userEmails.length,
        userEmails,
      };
    } catch (error) {
      logError(error, "NotificationService.notifyUsers");
      throw error;
    }
  }

  // Уведомление о новом комментарии
  async notifyAboutNewComment(commentId) {
    try {
      const comment = await Comment.findById(commentId)
        .populate("questionId")
        .populate("author", "email")
        .populate("parentComment");

      if (!comment) {
        throw new Error("Comment not found");
      }

      const notifications = [];

      // Уведомляем автора вопроса (если комментарий не от него)
      const questionAuthor = await User.findById(
        comment.questionId.author
      ).select("email");
      if (
        questionAuthor &&
        questionAuthor._id.toString() !== comment.author._id.toString()
      ) {
        notifications.push({
          type: "question_comment",
          userEmail: questionAuthor.email,
          questionTitle: comment.questionId.title,
          commentAuthor: comment.author.email,
        });
      }

      // Если это ответ на комментарий, уведомляем автора родительского комментария
      if (comment.parentComment) {
        const parentAuthor = await User.findById(
          comment.parentComment.author
        ).select("email");
        if (
          parentAuthor &&
          parentAuthor._id.toString() !== comment.author._id.toString()
        ) {
          notifications.push({
            type: "comment_reply",
            userEmail: parentAuthor.email,
            questionTitle: comment.questionId.title,
            replyAuthor: comment.author.email,
          });
        }
      }

      logUserAction(
        comment.author._id,
        "COMMENT_NOTIFICATIONS_SENT",
        `Sent ${notifications.length} notifications for new comment on question: ${comment.questionId.slug}`
      );

      return notifications;
    } catch (error) {
      logError(error, "NotificationService.notifyAboutNewComment");
      throw error;
    }
  }

  // Проверка иерархии ролей для уведомлений
  _isRolePromotion(oldRole, newRole) {
    const roleHierarchy = {
      [USER_ROLES.USER]: 1,
      [USER_ROLES.EXPERT]: 2,
      [USER_ROLES.ADMIN]: 3,
    };

    return roleHierarchy[newRole] > roleHierarchy[oldRole];
  }

  _isRoleDemotion(oldRole, newRole) {
    const roleHierarchy = {
      [USER_ROLES.USER]: 1,
      [USER_ROLES.EXPERT]: 2,
      [USER_ROLES.ADMIN]: 3,
    };

    return roleHierarchy[newRole] < roleHierarchy[oldRole];
  }

  // Получение настроек уведомлений пользователя (заготовка на будущее)
  async getUserNotificationSettings(userId) {
    try {
      // В будущем можно добавить модель NotificationSettings
      // Пока возвращаем дефолтные настройки
      return {
        userId,
        emailNotifications: {
          newAnswer: true,
          answerApproved: true,
          answerAccepted: true,
          roleChanged: true,
          newComment: true,
          accountBanned: true,
        },
        pushNotifications: {
          newAnswer: false,
          answerApproved: false,
          answerAccepted: true,
          roleChanged: true,
          newComment: false,
          accountBanned: true,
        },
      };
    } catch (error) {
      logError(
        error,
        "NotificationService.getUserNotificationSettings",
        userId
      );
      throw error;
    }
  }
}

export default new NotificationService();
