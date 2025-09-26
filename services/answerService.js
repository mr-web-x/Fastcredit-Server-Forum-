// services/answerService.js
import Answer from "../models/Answer.js";
import Question from "../models/Question.js";
import User from "../models/User.js";
import { QUESTION_STATUS, ANSWER_ACTIONS } from "../utils/constants.js";
import { logUserAction, logError, writeLog } from "../middlewares/logger.js";
import { createPaginationResponse } from "../utils/helpers.js";
import { socialService } from "./socialService.js";
import cryptoService from "./cryptoService.js";

class AnswerService {
  // Создание ответа на вопрос (только эксперты)
  async createAnswer(answerData, expertId) {
    try {
      const { content, questionId } = answerData;

      // Проверяем существование вопроса
      const question = await Question.findById(questionId);
      if (!question) {
        throw new Error("Otázka nebola nájdená");
      }

      // Проверяем, что эксперт не отвечает на свой вопрос
      if (question.author.toString() === expertId.toString()) {
        throw new Error("Nemôžete odpovedať na vlastnú otázku");
      }

      const existingAnswer = await Answer.findOne({
        questionId: questionId,
        expert: expertId,
      });

      if (existingAnswer) {
        throw new Error("Už ste odpovedali na túto otázku");
      }

      // Проверяем права эксперта
      const expert = await User.findById(expertId);
      if (!expert.isExpert()) {
        throw new Error("Iba experti môžu odpovedať na otázky");
      }

      // Создаем ответ (по умолчанию требует модерации)
      const answer = new Answer({
        content,
        questionId,
        expert: expertId,
        isApproved: false, // все ответы сначала на модерации
      });

      await answer.save();

      // Загружаем ответ с экспертом и вопросом
      const populatedAnswer = await Answer.findById(answer._id)
        .populate(
          "expert",
          "firstName lastName email originalEmail role avatar bio rating"
        )
        .populate("questionId", "title slug");
      console.log("1", populatedAnswer);

      await cryptoService.smartDecrypt(populatedAnswer);

      console.log("2", populatedAnswer);

      logUserAction(
        expertId,
        "ANSWER_CREATED",
        `Created answer for question: ${question.slug}`
      );

      return populatedAnswer;
    } catch (error) {
      logError(error, "AnswerService.createAnswer", expertId);
      throw error;
    }
  }

  // Получение ответов на вопрос
  async getAnswersForQuestion(questionId, options = {}) {
    try {
      const {
        includeUnapproved = false,
        sortBy = "isAccepted",
        sortOrder = -1,
      } = options;

      const query = { questionId };

      // Обычные пользователи видят только одобренные ответы
      if (!includeUnapproved) {
        query.isApproved = true;
      }

      const answers = await Answer.find(query)
        .populate(
          "expert",
          "firstName lastName email originalEmail role avatar bio rating totalAnswers"
        )
        .sort({ [sortBy]: sortOrder, likes: -1, createdAt: -1 });

      await cryptoService.smartDecrypt(answers);

      return answers;
    } catch (error) {
      logError(error, "AnswerService.getAnswersForQuestion");
      throw error;
    }
  }

  // Получение ответов эксперта
  async getExpertAnswers(expertId, options = {}) {
    try {
      const { page = 1, limit = 20, isApproved = null } = options;
      const skip = (page - 1) * limit;

      const query = { expert: expertId };
      if (isApproved !== null) query.isApproved = isApproved;

      const [answers, total] = await Promise.all([
        Answer.find(query)
          .populate("questionId", "title slug status")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Answer.countDocuments(query),
      ]);

      await cryptoService.smartDecrypt(answers);

      return createPaginationResponse(answers, total, page, limit);
    } catch (error) {
      logError(error, "AnswerService.getExpertAnswers", expertId);
      throw error;
    }
  }

  // Модерация ответа (только админы)
  async moderateAnswer(answerId, isApproved, moderatorId, comment = null) {
    try {
      const answer = await Answer.findById(answerId)
        .populate("questionId")
        .populate("expert");

      if (!answer) {
        throw new Error("Odpoveď nebola nájdená");
      }

      await cryptoService.smartDecrypt(answer);

      // Проверяем права модератора
      const moderator = await User.findById(moderatorId);
      if (!moderator || !moderator.canModerate) {
        throw new Error("Iba moderátori môžu moderovať odpovede");
      }

      await cryptoService.smartDecrypt(moderator);

      const oldStatus = answer.isApproved;

      if (isApproved) {
        // Одобряем ответ
        await answer.approve(moderatorId, comment);
        logUserAction(
          moderatorId,
          "ANSWER_APPROVED",
          `Approved answer ${answerId} for question: ${answer.questionId.slug}`
        );
      } else {
        // Отклоняем ответ
        await answer.reject(moderatorId, comment);
        logUserAction(
          moderatorId,
          "ANSWER_REJECTED",
          `Rejected answer ${answerId} for question: ${answer.questionId.slug}`
        );
      }

      const question = await Question.findById(answer.questionId);

      if (isApproved && !oldStatus) {
        await question.incrementAnswers();

        await cryptoService.smartDecrypt(answer);
        await cryptoService.smartDecrypt(question);

        const questionUrl = `${process.env.FRONTEND_URL}/forum/questions/${question.slug}`;

        // Публикуем в социальные сети
        try {
          await socialService.republishAnswerPosts(
            answerId,
            question,
            answer,
            questionUrl,
            moderatorId
          );
        } catch (socialError) {
          logError(
            socialError,
            "Failed to publish to social media after approval",
            moderatorId
          );
        }
      } else if (!isApproved && oldStatus) {
        await question.decrementAnswers();
        // Удаляем социальные посты если они есть
        if (answer.socialPosts && answer.socialPosts.length > 0) {
          try {
            await socialService.deleteAnswerPosts(answerId, moderatorId);
          } catch (socialError) {
            logError(
              socialError,
              "Failed to delete social posts after rejection",
              moderatorId
            );
          }
        }
      }

      if (!isApproved && oldStatus) {
        const remainingApprovedAnswers = await Answer.countDocuments({
          questionId: answer.questionId._id,
          isApproved: true,
        });

        const newStatus =
          remainingApprovedAnswers > 0
            ? QUESTION_STATUS.ANSWERED
            : QUESTION_STATUS.PENDING;

        await Question.findByIdAndUpdate(answer.questionId._id, {
          status: newStatus,
        });
      }

      const answerResult = await Answer.findById(answerId)
        .populate("expert", "firstName lastName email role avatar")
        .populate("moderatedBy", "email role")
        .populate("questionId", "title slug");

      await cryptoService.smartDecrypt(answerResult);

      return answerResult;
    } catch (error) {
      logError(error, "AnswerService.moderateAnswer", moderatorId);
      throw error;
    }
  }

  // Принятие ответа как лучшего (только автор вопроса)
  async acceptAnswer(answerId, userId) {
    try {
      const answer = await Answer.findById(answerId)
        .populate("questionId")
        .populate("expert");

      if (!answer) {
        throw new Error("Odpoveď nebola nájdená");
      }

      if (!answer.isApproved) {
        throw new Error("Nie je možné prijať neodobrenú odpoveď");
      }

      // Проверяем, что пользователь - автор вопроса
      if (answer.questionId.author.toString() !== userId.toString()) {
        throw new Error("Iba autor otázky môže prijať odpoveď");
      }

      if (answer.questionId.hasAcceptedAnswer) {
        throw new Error("Otázka už má prijatú odpoveď");
      }

      // Принимаем ответ
      await answer.accept();

      // Обновляем статус вопроса
      await Question.findByIdAndUpdate(answer.questionId._id, {
        hasAcceptedAnswer: true,
        status: QUESTION_STATUS.ANSWERED,
      });

      // Увеличиваем рейтинг эксперта
      const expert = await User.findById(answer.expert._id);
      await expert.updateRating(expert.rating + 10); // +10 за принятый ответ

      logUserAction(
        userId,
        "ANSWER_ACCEPTED",
        `Accepted answer ${answerId} from expert ${answer.expert.email}`
      );

      const updatedAnswer = await Answer.findById(answerId)
        .populate(
          "expert",
          "firstName lastName originalEmail role avatar bio rating"
        ) // добавляем originalEmail
        .populate("questionId", "title slug");

      await cryptoService.smartDecrypt(updatedAnswer);

      return updatedAnswer;
    } catch (error) {
      logError(error, "AnswerService.acceptAnswer", userId);
      throw error;
    }
  }

  // Файл: services/AnswerService.js (на бэкенде)
  async updateAnswer(answerId, updateData, userId) {
    try {
      const answer = await Answer.findById(answerId);

      if (!answer) {
        throw new Error("Odpoveď nebola nájdená");
      }

      const user = await User.findById(userId);
      if (!user) {
        throw new Error("Používateľ nebol nájdený");
      }

      // Проверяем права (автор ответа или админ)
      const canEdit =
        answer.expert.toString() === userId.toString() || user.role === "admin";

      if (!canEdit) {
        throw new Error("Nemáte oprávnenie upraviť túto odpoveď");
      }

      const { content } = updateData;
      if (!content || content.trim().length === 0) {
        throw new Error("Obsah je povinný");
      }

      if (content.trim().length < 50) {
        throw new Error("Odpoveď musí mať aspoň 50 znakov");
      }

      if (content.trim().length > 5000) {
        throw new Error("Odpoveď nemôže presiahnuť 5000 znakov");
      }

      const question = await Question.findById(answer.questionId);
      const wasApproved = answer.isApproved;

      // 1. Обновляем контент и сохраняем
      answer.content = content.trim();
      answer.updatedAt = new Date();

      // Добавляем UPDATE action
      answer.actions.push({
        action: ANSWER_ACTIONS.UPDATE,
        info: `Answer content updated by ${
          user.role === "admin" ? "admin" : "expert"
        }`,
      });

      await answer.save();

      // 2. Обрабатываем социальные посты в зависимости от роли пользователя

      // Если одобренный ответ редактирует эксперт → сбрасываем одобрение и удаляем посты
      if (wasApproved && user.role !== "admin") {
        answer.isApproved = false;
        answer.moderatedBy = null;
        answer.moderatedAt = null;
        answer.moderationComment = null;

        await question.decrementAnswers();

        // Сохраняем изменения статуса
        await answer.save();

        // Удаляем социальные посты (в отдельном try-catch)
        if (answer.socialPosts && answer.socialPosts.length > 0) {
          try {
            await socialService.deleteAnswerPosts(answerId, userId);
          } catch (socialError) {
            logError(
              socialError,
              "Failed to delete social posts after expert edit",
              userId
            );
            writeLog(
              "WARNING",
              `Social media deletion failed for answer ${answerId}, but status was reset successfully`
            );
          }
        }
      }

      // Если одобренный ответ редактирует админ → перепубликовываем с новым контентом
      if (wasApproved && user.role === "admin") {
        const questionUrl = `${process.env.FRONTEND_URL}/forum/questions/${question.slug}`;

        // Получаем обновленный объект answer из базы для актуального контента
        const updatedAnswer = await Answer.findById(answerId);

        // Перепубликовываем посты (в отдельном try-catch)
        try {
          await socialService.republishAnswerPosts(
            answerId,
            question,
            updatedAnswer,
            questionUrl,
            userId
          );
        } catch (socialError) {
          logError(
            socialError,
            "Failed to republish social posts after admin edit",
            userId
          );
          writeLog(
            "WARNING",
            `Social media republish failed for answer ${answerId}, but content was updated successfully`
          );
        }
      }

      logUserAction(userId, "ANSWER_UPDATED", `Updated answer ${answerId}`);

      const resultAnswer = await Answer.findById(answerId)
        .populate("expert", "firstName lastName originalEmail role avatar")
        .populate("questionId", "title slug");

      await cryptoService.smartDecrypt(resultAnswer);

      return resultAnswer;
    } catch (error) {
      logError(error, "AnswerService.updateAnswer", userId);
      throw error;
    }
  }

  // Удаление ответа (только автор или админ)
  async deleteAnswer(answerId, userId) {
    try {
      const answer = await Answer.findById(answerId).populate("questionId");

      if (!answer) {
        throw new Error("Odpoveď nebola nájdená");
      }

      // Проверяем права (автор ответа или админ)
      const user = await User.findById(userId);
      const canDelete =
        answer.expert.toString() === userId.toString() || user.role === "admin";

      if (!canDelete) {
        throw new Error("Nemáte oprávnenie odstrániť túto odpoveď");
      }

      if (answer.wasApproved && user.role !== "admin") {
        throw new Error("Nie je možné odstrániť odpoveď, ktorá bola predtým schválená");
      }

      // Удаляем социальные посты если они есть
      if (answer.socialPosts && answer.socialPosts.length > 0) {
        try {
          await socialService.deleteAnswerPosts(answerId, userId);
        } catch (socialError) {
          logError(
            socialError,
            "Failed to delete social posts before answer deletion",
            userId
          );
        }
      }

      // Если это принятый ответ, сбрасываем статус у вопроса
      if (answer.isAccepted) {
        await Question.findByIdAndUpdate(answer.questionId._id, {
          hasAcceptedAnswer: false,
          status: QUESTION_STATUS.PENDING, // Сбрасываем статус, так как принятый ответ удален
        });
      }

      const question = await Question.findById(answer.questionId._id);

      // Если удаляем одобренный ответ, уменьшаем счетчик
      if (answer.isApproved) {
        await question.decrementAnswers();

        // Пересчитываем статус вопроса на основе оставшихся одобренных ответов
        const remainingApprovedAnswers = await Answer.countDocuments({
          questionId: answer.questionId._id,
          isApproved: true,
          _id: { $ne: answerId }, // Исключаем удаляемый ответ
        });

        // Обновляем статус вопроса (только если это не принятый ответ, который уже обработан выше)
        if (!answer.isAccepted) {
          const newStatus =
            remainingApprovedAnswers > 0
              ? QUESTION_STATUS.ANSWERED
              : QUESTION_STATUS.PENDING;

          await Question.findByIdAndUpdate(answer.questionId._id, {
            status: newStatus,
          });
        }
      }

      // Удаляем ответ (это также запустит pre-remove middleware)
      await Answer.findByIdAndDelete(answerId);

      logUserAction(userId, "ANSWER_DELETED", `Deleted answer ${answerId}`);

      return true;
    } catch (error) {
      logError(error, "AnswerService.deleteAnswer", userId);
      throw error;
    }
  }

  // Получение ответов на модерации
  async getPendingAnswers(options = {}) {
    try {
      const { page = 1, limit = 20 } = options;
      const skip = (page - 1) * limit;

      const [answers, total] = await Promise.all([
        Answer.find({ isApproved: false })
          .populate("expert", "firstName lastName email role avatar")
          .populate("questionId", "title slug")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Answer.countDocuments({ isApproved: false }),
      ]);

      await cryptoService.smartDecrypt(answers);

      return createPaginationResponse(answers, total, page, limit);
    } catch (error) {
      logError(error, "AnswerService.getPendingAnswers");
      throw error;
    }
  }

  // Статистика по ответам
  async getAnswerStatistics() {
    try {
      const [
        totalAnswers,
        approvedAnswers,
        pendingAnswers,
        acceptedAnswers,
        recentAnswers,
      ] = await Promise.all([
        Answer.countDocuments(),
        Answer.countDocuments({ isApproved: true }),
        Answer.countDocuments({ isApproved: false }),
        Answer.countDocuments({ isAccepted: true }),
        Answer.countDocuments({
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        }),
      ]);

      // Топ экспертов по количеству ответов
      const topExperts = await Answer.aggregate([
        { $match: { isApproved: true } },
        {
          $group: {
            _id: "$expert",
            totalAnswers: { $sum: 1 },
            acceptedAnswers: { $sum: { $cond: ["$isAccepted", 1, 0] } },
            totalLikes: { $sum: "$likes" },
          },
        },
        { $sort: { totalAnswers: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: "users",
            localField: "_id",
            foreignField: "_id",
            as: "expert",
            pipeline: [
              { $project: { email: 1, role: 1, avatar: 1, rating: 1 } },
            ],
          },
        },
        { $unwind: "$expert" },
      ]);

      return {
        total: totalAnswers,
        approved: approvedAnswers,
        pending: pendingAnswers,
        accepted: acceptedAnswers,
        recent: recentAnswers,
        approvalRate:
          totalAnswers > 0
            ? ((approvedAnswers / totalAnswers) * 100).toFixed(2)
            : 0,
        acceptanceRate:
          approvedAnswers > 0
            ? ((acceptedAnswers / approvedAnswers) * 100).toFixed(2)
            : 0,
        topExperts,
      };
    } catch (error) {
      logError(error, "AnswerService.getAnswerStatistics");
      throw error;
    }
  }

  // Получение лучших ответов эксперта
  async getExpertBestAnswers(expertId, limit = 10) {
    try {
      const bestAnswers = await Answer.find({
        expert: expertId,
        isApproved: true,
        $or: [{ isAccepted: true }, { likes: { $gte: 5 } }],
      })
        .populate("questionId", "title slug")
        .sort({ isAccepted: -1, likes: -1 })
        .limit(limit)
        .select("content likes isAccepted createdAt");

      return bestAnswers;
    } catch (error) {
      logError(error, "AnswerService.getExpertBestAnswers", expertId);
      throw error;
    }
  }
}

export default new AnswerService();
