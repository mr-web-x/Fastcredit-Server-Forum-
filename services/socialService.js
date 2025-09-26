// services/socialService.js
import axios from "axios";
import { socialConfig, socialTemplates } from "../config/social.js";
import { writeLog } from "../middlewares/logger.js";
import SocialToken from "../models/SocialToken.js";
import Answer from "../models/Answer.js";
import { SOCIAL_PLATFORMS, ANSWER_ACTIONS } from "../utils/constants.js";
import { logError } from "../middlewares/logger.js";
import cryptoService from "./cryptoService.js";

class SocialService {
  constructor() {
    this.facebookConfig = socialConfig.facebook;
    this.linkedinConfig = socialConfig.linkedin;
    this.templates = socialTemplates;
  }

  /**
   * Функиця для генерации контента поста
   * @param {object} question - текст поста
   * @param {object} answer - ссылка на вопрос/статью
   * @param {string} questionUrl - url
   */
  generateContentPost(question, answer, questionUrl) {
    writeLog("INFO", "Start generating post content...");

    const template =
      this.templates[Math.floor(Math.random() * this.templates.length)];

    const expertName =
      answer.expert?.firstName + answer.expert?.lastName || "Náš expert";
    const answerPreview = answer.content.substring(0, 100) + "...";

    const socialContent = template.format
      .replace("{hook}", template.hook)
      .replace("{question}", question.title)
      .replace("{expertName}", expertName)
      .replace("{answerPreview}", answerPreview)
      .replace("{url}", questionUrl);

    writeLog("SUCCESS", "Post content was generated:", socialContent);

    return socialContent;
  }

  // --------------------- FACEBOOK -------------

  /**
   * Публикация поста на бизнес-странице
   * @param {string} content - текст поста
   */
  async facebookPublishPost(content) {
    writeLog("INFO", "Start publishing post on facebook...");

    try {
      const { baseUrl, pageId, token } = this.facebookConfig;
      const url = `${baseUrl}/${pageId}/feed`;

      const response = await axios.post(url, {
        message: content,
        access_token: token,
      });

      const postId = response.data.id;
      writeLog("SUCCESS", `Post was published on facebook! Post ID: ${postId}`);

      return { ...response.data, postId };
    } catch (error) {
      writeLog("ERROR", `Error facebook posting: ${error.message}`);
      throw error;
    }
  }

  /**
   * Видалення поста з Facebook бізнес-сторінки
   * @param {string} postId - ID поста для видалення
   * @returns {Promise<{status: boolean, message: string}>}
   */
  async facebookDeletePost(postId) {
    if (!postId) {
      return { status: false, message: "Post ID is required" };
    }

    writeLog("INFO", `Start deleting Facebook post with ID: ${postId}`);

    try {
      const { baseUrl, token } = this.facebookConfig;
      const url = `${baseUrl}/${postId}`;

      const response = await axios.delete(url, {
        params: {
          access_token: token,
        },
      });

      // Facebook повертає {"success": true} при успішному видаленні
      if (response.data && response.data.success === true) {
        const message = `Post with ID ${postId} was successfully deleted from Facebook`;
        writeLog("SUCCESS", message);
        return { status: true, message };
      } else {
        const message = `Failed to delete Facebook post with ID ${postId}`;
        writeLog("ERROR", message);
        return { status: false, message };
      }
    } catch (error) {
      const errorMessage =
        error.response?.data?.error?.message || error.message;
      const message = `Error deleting Facebook post ${postId}: ${errorMessage}`;
      writeLog("ERROR", message);
      return { status: false, message };
    }
  }

  // --------------------- LINKEDIN -------------

  /**
   * Проверка срока действия LinkedIn токена
   * @returns {Promise<string>} access_token
   */
  async getValidLinkedInToken() {
    let tokenDoc = await SocialToken.findOne({ provider: "linkedin" });

    await cryptoService.smartDecrypt(tokenDoc);

    if (!tokenDoc) {
      throw new Error("LinkedIn token not found in DB");
    }

    // Если токен ещё живой
    if (
      tokenDoc.access_token_expires_at &&
      tokenDoc.access_token_expires_at > new Date()
    ) {
      return tokenDoc.access_token;
    }

    // Иначе обновляем через refresh_token
    if (
      tokenDoc.refresh_token_expires_at &&
      tokenDoc.refresh_token_expires_at > new Date()
    ) {
      try {
        writeLog("INFO", "Refreshing LinkedIn access token...");

        const response = await axios.post(
          "https://www.linkedin.com/oauth/v2/accessToken",
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: tokenDoc.refresh_token,
            client_id: this.linkedinConfig.clientId,
            client_secret: this.linkedinConfig.clientSecret,
          }),
          {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          }
        );

        const {
          access_token,
          expires_in,
          refresh_token,
          refresh_token_expires_in,
        } = response.data;

        tokenDoc.access_token = access_token;
        tokenDoc.access_token_expires_at = new Date(
          Date.now() + expires_in * 1000
        );

        if (refresh_token) {
          tokenDoc.refresh_token = refresh_token;
          tokenDoc.refresh_token_expires_at = new Date(
            Date.now() + refresh_token_expires_in * 1000
          );
        }

        await tokenDoc.save();
        writeLog("SUCCESS", "LinkedIn token refreshed");

        return access_token;
      } catch (err) {
        writeLog(
          "ERROR",
          `Failed to refresh LinkedIn token: ${
            err.response?.data?.error_description || err.message
          }`
        );
        throw err;
      }
    }

    throw new Error("LinkedIn refresh token expired — manual OAuth required");
  }

  /**
   * Публикация поста в LinkedIn от имени организации
   * @param {string} content - текст поста
   */
  async linkedinPublishPost(content, title, url) {
    writeLog("INFO", "Start publishing post on LinkedIn using Posts API...");

    try {
      const token = await this.getValidLinkedInToken();

      const payload = {
        author: `urn:li:organization:${this.linkedinConfig.organizationId}`,
        commentary: content,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: {
          article: {
            source: url,
            title: title,
          },
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      };

      const response = await axios.post(this.linkedinConfig.baseUrl, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "LinkedIn-Version": "202501", // Обязательный заголовок
          "X-Restli-Protocol-Version": "2.0.0", // Все еще нужен
        },
      });

      const postId = response.headers["x-restli-id"];
      writeLog("SUCCESS", `Post published via Posts API! Post ID: ${postId}`);

      return { ...response.data, postId };
    } catch (error) {
      const errMsg =
        error.response?.data?.message || error.response?.data || error.message;
      writeLog("ERROR", `Posts API error: ${JSON.stringify(errMsg, null, 2)}`);
      throw error;
    }
  }

  /**
   * Видалення поста з LinkedIn (Posts API)
   * @param {string} postId - URN або ID поста для видалення
   * @returns {Promise<{status: boolean, message: string}>}
   */
  async linkedinDeletePost(postId) {
    if (!postId) {
      return { status: false, message: "Post ID is required" };
    }

    writeLog("INFO", `Start deleting LinkedIn post with ID: ${postId}`);

    try {
      const token = await this.getValidLinkedInToken();

      const baseUrl = this.linkedinConfig.baseUrl;
      const url = `${baseUrl}/${encodeURIComponent(postId)}`;

      const response = await axios.delete(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "LinkedIn-Version": "202501", // Обов'язковий заголовок
          "X-Restli-Protocol-Version": "2.0.0",
          "X-RestLi-Method": "DELETE", // Обов'язковий для DELETE операцій
        },
      });

      // LinkedIn повертає статус 204 No Content при успішному видаленні
      if (response.status === 204) {
        const message = `Post with ID ${postId} was successfully deleted from LinkedIn`;
        writeLog("SUCCESS", message);
        return { status: true, message };
      } else {
        const message = `Unexpected response status ${response.status} when deleting LinkedIn post ${postId}`;
        writeLog("ERROR", message);
        return { status: false, message };
      }
    } catch (error) {
      // LinkedIn може повертати різні типи помилок
      const errorMessage =
        error.response?.data?.message ||
        error.response?.data?.error_description ||
        error.response?.data ||
        error.message;
      const message = `Error deleting LinkedIn post ${postId}: ${JSON.stringify(
        errorMessage
      )}`;
      writeLog("ERROR", message);
      return { status: false, message };
    }
  }

  // --------------------- SOCIAL ANSWERS -------------

  /**
   * Republish answer posts: check → delete old → publish new → add action
   * @param {string} answerId - ID ответа
   * @param {object} question - объект вопроса
   * @param {object} answer - объект ответа
   * @param {string} questionUrl - URL вопроса
   * @param {string} moderatorId - ID модератора для логирования
   */
  async republishAnswerPosts(
    answerId,
    question,
    answer,
    questionUrl,
    moderatorId
  ) {
    writeLog("INFO", `Start republishing answer ${answerId} to social media`);

    const socialContent = this.generateContentPost(
      question,
      answer,
      questionUrl
    );
    const currentAnswer = await Answer.findById(answerId);

    // Facebook
    try {
      const existingFBPost = currentAnswer.socialPosts?.find(
        (post) => post.platform === SOCIAL_PLATFORMS.FACEBOOK
      );

      // Удаляем старый пост если есть
      if (existingFBPost?.postId) {
        writeLog(
          "INFO",
          `Deleting old Facebook post: ${existingFBPost.postId}`
        );
        const deleteResult = await this.facebookDeletePost(
          existingFBPost.postId
        );
        if (deleteResult.status) {
          writeLog("SUCCESS", `Old Facebook post deleted successfully`);
          // Добавляем действие удаления
          await Answer.findByIdAndUpdate(answerId, {
            $push: {
              actions: {
                action: ANSWER_ACTIONS.SOCIAL_DELETE,
                info: "Old Facebook post deleted before republishing",
              },
            },
          });
        }
      }

      // Публикуем новый пост
      writeLog("INFO", `Publishing new Facebook post`);
      const { postId } = await this.facebookPublishPost(socialContent);

      if (postId) {
        // Удаляем старую запись и добавляем новую (надежный подход)
        await Answer.findByIdAndUpdate(answerId, {
          $pull: { socialPosts: { platform: SOCIAL_PLATFORMS.FACEBOOK } },
        });

        await Answer.findByIdAndUpdate(answerId, {
          $push: {
            socialPosts: { platform: SOCIAL_PLATFORMS.FACEBOOK, postId },
            actions: {
              action: ANSWER_ACTIONS.SOCIAL_PUBLISH,
              info: `New Facebook post published: ${postId}`,
            },
          },
        });

        writeLog("SUCCESS", `New Facebook post published with ID: ${postId}`);
      }
    } catch (err) {
      writeLog("ERROR", `Facebook publish failed: ${err.message}`);
      logError(err, "Facebook publish failed", moderatorId);
    }

    // LinkedIn
    try {
      const existingLIPost = currentAnswer.socialPosts?.find(
        (post) => post.platform === SOCIAL_PLATFORMS.LINKEDIN
      );

      // Удаляем старый пост если есть
      if (existingLIPost?.postId) {
        writeLog(
          "INFO",
          `Deleting old LinkedIn post: ${existingLIPost.postId}`
        );
        const deleteResult = await this.linkedinDeletePost(
          existingLIPost.postId
        );
        if (deleteResult.status) {
          writeLog("SUCCESS", `Old LinkedIn post deleted successfully`);
          // Добавляем действие удаления
          await Answer.findByIdAndUpdate(answerId, {
            $push: {
              actions: {
                action: ANSWER_ACTIONS.SOCIAL_DELETE,
                info: "Old LinkedIn post deleted before republishing",
              },
            },
          });
        }
      }

      // Публикуем новый пост
      writeLog("INFO", `Publishing new LinkedIn post`);
      const { postId } = await this.linkedinPublishPost(
        socialContent,
        question.title,
        questionUrl
      );

      if (postId) {
        // Удаляем старую запись и добавляем новую (надежный подход)
        await Answer.findByIdAndUpdate(answerId, {
          $pull: { socialPosts: { platform: SOCIAL_PLATFORMS.LINKEDIN } },
        });

        await Answer.findByIdAndUpdate(answerId, {
          $push: {
            socialPosts: { platform: SOCIAL_PLATFORMS.LINKEDIN, postId },
            actions: {
              action: ANSWER_ACTIONS.SOCIAL_PUBLISH,
              info: `New LinkedIn post published: ${postId}`,
            },
          },
        });

        writeLog("SUCCESS", `New LinkedIn post published with ID: ${postId}`);
      }
    } catch (err) {
      writeLog("ERROR", `LinkedIn publish failed: ${err.message}`);
      logError(err, "LinkedIn publish failed", moderatorId);
    }

    writeLog("SUCCESS", `Answer ${answerId} republishing completed`);
  }

  /**
   * Delete all social posts for answer + remove objects from socialPosts array + add action
   * @param {string} answerId - ID ответа
   * @param {string} userId - ID пользователя для логирования
   */
  async deleteAnswerPosts(answerId, userId) {
    writeLog("INFO", `Start deleting social posts for answer ${answerId}`);

    try {
      const answer = await Answer.findById(answerId);
      if (!answer || !answer.socialPosts || answer.socialPosts.length === 0) {
        writeLog("INFO", `No social posts found for answer ${answerId}`);
        return;
      }

      const platformsToDelete = [];
      const deletedPlatformNames = [];

      // Удаляем посты из каждой социальной сети
      for (const socialPost of answer.socialPosts) {
        if (!socialPost.postId) continue;

        try {
          let deleteResult = {
            status: false,
            message: "Platform not supported",
          };

          // Выбираем метод удаления
          switch (socialPost.platform) {
            case SOCIAL_PLATFORMS.FACEBOOK:
              deleteResult = await this.facebookDeletePost(socialPost.postId);
              break;
            case SOCIAL_PLATFORMS.LINKEDIN:
              deleteResult = await this.linkedinDeletePost(socialPost.postId);
              break;
            default:
              writeLog(
                "WARNING",
                `Unsupported platform: ${socialPost.platform}`
              );
              continue;
          }

          // Добавляем платформу для удаления из базы независимо от результата API
          // (потому что пост может уже не существовать в соцсети, но запись в базе есть)
          platformsToDelete.push(socialPost.platform);

          // Логируем результат
          if (deleteResult.status) {
            writeLog(
              "SUCCESS",
              `Deleted ${socialPost.platform} post: ${socialPost.postId}`
            );
            deletedPlatformNames.push(socialPost.platform);
          } else {
            writeLog(
              "ERROR",
              `Failed to delete ${socialPost.platform} post: ${deleteResult.message}`
            );
            // Все равно удаляем из базы, так как пост может уже не существовать
            deletedPlatformNames.push(
              `${socialPost.platform} (not found in social network)`
            );
          }
        } catch (error) {
          writeLog(
            "ERROR",
            `Error deleting ${socialPost.platform} post ${socialPost.postId}: ${error.message}`
          );
          logError(error, `Delete ${socialPost.platform} post failed`, userId);

          // Все равно добавляем для удаления из базы
          platformsToDelete.push(socialPost.platform);
          deletedPlatformNames.push(
            `${socialPost.platform} (error during deletion)`
          );
        }
      }

      // Удаляем все объекты socialPosts (независимо от результатов API)
      if (platformsToDelete.length > 0) {
        await Answer.findByIdAndUpdate(answerId, {
          $pull: { socialPosts: { platform: { $in: platformsToDelete } } },
          $push: {
            actions: {
              action: ANSWER_ACTIONS.SOCIAL_DELETE,
              info: `Social posts cleanup completed for: ${deletedPlatformNames.join(
                ", "
              )}`,
            },
          },
        });
      }

      writeLog(
        "SUCCESS",
        `Social posts deletion completed for answer ${answerId}`
      );
    } catch (error) {
      writeLog("ERROR", `Error in deleteAnswerPosts: ${error.message}`);
      logError(error, "SocialService.deleteAnswerPosts", userId);
    }
  }
}

export const socialService = new SocialService();
