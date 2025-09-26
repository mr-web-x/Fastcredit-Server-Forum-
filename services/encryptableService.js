import cryptoService from "./cryptoService.js";

// Базовый класс для шифрования/расшифровки
class EncryptableService {
  static applyEncryption(schema, encryptedFields) {
    // Вспомогательные функции для работы с вложенными полями
    function getNestedValue(obj, path) {
      const parts = path.split(".");
      let current = obj;
      for (const part of parts) {
        if (!current || typeof current !== "object") return null;
        current = current[part];
      }
      return current;
    }

    function setNestedValue(obj, path, value) {
      const parts = path.split(".");
      let current = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) current[parts[i]] = {};
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
    }

    /**
     * Batch шифрование полей объекта
     * @param {Object} obj - объект для обработки
     * @param {Array} fieldsToProcess - список полей для шифрования
     * @returns {Promise} - промис выполнения
     */
    async function encryptFieldsBatch(obj, fieldsToProcess) {
      // Собираем все поля для шифрования в один объект
      const fieldsToEncrypt = {};

      for (const field of fieldsToProcess) {
        let actualValue = null;

        // Спочатку пробуємо отримати значення через вкладену структуру
        const nestedValue = getNestedValue(obj, field);

        // Потім перевіряємо чи є значення за прямим ключем з крапковою нотацією
        const dotNotationValue = obj[field];

        // Визначаємо фактичне значення
        if (nestedValue !== null && nestedValue !== undefined) {
          actualValue = nestedValue;
        } else if (
          dotNotationValue !== null &&
          dotNotationValue !== undefined
        ) {
          actualValue = dotNotationValue;
        }

        console.log(
          "[ENCRYPTABLE]",
          field,
          "-------------------------------------------"
        );

        if (
          actualValue !== null &&
          actualValue !== undefined &&
          actualValue !== ""
        ) {
          if (
            typeof actualValue === "string" &&
            actualValue.startsWith("U2FsdGVk")
          ) {
            console.log("[ENCRYPTABLE]", field, "зашифровано - пропускаем");
            continue; // Пропускаем повторное шифрование
          }
          fieldsToEncrypt[field] = String(actualValue);
        }
      }

      // Если есть поля для шифрования - делаем один запрос
      if (Object.keys(fieldsToEncrypt).length > 0) {
        const encrypted = await cryptoService.cryptoData(fieldsToEncrypt);

        // Применяем зашифрованные значения обратно в объект
        for (const [field, encryptedValue] of Object.entries(encrypted)) {
          // Пробуємо встановити значення через вкладену структуру
          const currentNestedValue = getNestedValue(obj, field);

          if (currentNestedValue !== null && currentNestedValue !== undefined) {
            // Якщо поле існує у вкладеній структурі - оновлюємо там
            setNestedValue(obj, field, encryptedValue);
          } else if (obj[field] !== undefined) {
            // Якщо поле існує у крапковій нотації - оновлюємо там
            obj[field] = encryptedValue;
          } else {
            // Якщо поле не знайдено - створюємо у вкладеній структурі
            setNestedValue(obj, field, encryptedValue);
          }
        }
      }
    }

    /**
     * Асинхронный middleware для шифрования перед сохранением/обновлением
     */
    async function cryptoMiddleware(next) {
      try {
        const update = this.getUpdate ? this.getUpdate() : this;

        if (this.getUpdate) {
          // --- Обработка update операций ---

          // Batch шифрование для $set
          if (update.$set) {
            await encryptFieldsBatch(update.$set, encryptedFields);
          }

          // Batch шифрование для $push.$each (якщо потрібно)
          if (update.$push) {
            for (const [key, value] of Object.entries(update.$push)) {
              if (value.$each && Array.isArray(value.$each)) {
                for (const item of value.$each) {
                  await encryptFieldsBatch(item, encryptedFields);
                }
              }
            }
          }

          // Batch шифрование для прямых полей (без операторов)
          const directFields = Object.keys(update).filter(
            (key) => !key.startsWith("$")
          );
          if (directFields.length > 0) {
            const directUpdate = {};
            directFields.forEach((key) => {
              directUpdate[key] = update[key];
            });
            await encryptFieldsBatch(directUpdate, encryptedFields);

            // Повертаємо оброблені значення назад
            directFields.forEach((key) => {
              update[key] = directUpdate[key];
            });
          }
        } else {
          // --- Новый документ или save операция ---
          await encryptFieldsBatch(this, encryptedFields);
        }

        next();
      } catch (err) {
        next(err);
      }
    }

    // Применяем middleware ко всем операциям сохранения/обновления
    schema.pre("save", cryptoMiddleware);
    schema.pre("findOneAndUpdate", cryptoMiddleware);
    schema.pre("findByIdAndUpdate", cryptoMiddleware);
    schema.pre("updateOne", cryptoMiddleware);
    schema.pre("updateMany", cryptoMiddleware);

    /**
     * Асинхронная проверка, зашифровано ли поле (БЕЗ ИЗМЕНЕНИЙ)
     * Оставляем как есть - для одиночных проверок batch не нужен
     */
    schema.methods.isEncrypted = async function (field) {
      const value = getNestedValue(this, field);
      if (!value) return false;
      try {
        await cryptoService.decryptData(value);
        return true;
      } catch {
        return false;
      }
    };

    /**
     * Асинхронная расшифровка всех полей документа (ОБНОВЛЕНО - batch)
     */
    schema.methods.decrypt = async function () {
      // Собираем все зашифрованные поля в один объект
      const fieldsToDecrypt = {};

      for (const field of encryptedFields) {
        const value = getNestedValue(this, field);
        if (value !== null && value !== undefined && value !== "") {
          fieldsToDecrypt[field] = value;
        }
      }

      // Если есть поля для расшифровки - делаем один запрос
      if (Object.keys(fieldsToDecrypt).length > 0) {
        try {
          const decrypted = await cryptoService.decryptData(fieldsToDecrypt);

          // Применяем расшифрованные значения обратно в документ
          for (const [field, decryptedValue] of Object.entries(decrypted)) {
            setNestedValue(this, field, decryptedValue);
          }
        } catch (error) {
          // Если любое поле не расшифровалось - устанавливаем все в null
          // (согласно изначальному поведению)
          for (const field of encryptedFields) {
            const value = getNestedValue(this, field);
            if (value !== null && value !== undefined && value !== "") {
              setNestedValue(this, field, null);
            }
          }
        }
      }

      return this;
    };

    /**
     * JSON/Объект без авто-дешифровки (БЕЗ ИЗМЕНЕНИЙ)
     */
    schema.set("toJSON", {
      virtuals: true,
      id: false,
    });
    schema.set("toObject", {
      virtuals: true,
      id: false,
    });
  }
}

export default EncryptableService;
