// scripts/createAdmin.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../models/User.js";
import { USER_ROLES } from "../utils/constants.js";

// Загружаем переменные окружения
dotenv.config();

const createSuperAdmin = async () => {
  try {
    // Подключение к базе данных
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("📦 Подключен к MongoDB");

    // Данные суперадмина (можно передавать через переменные окружения)
    const adminData = {
      email: process.env.ADMIN_EMAIL || "admin@fastcredit.sk",
      password: process.env.ADMIN_PASSWORD || "admin123456", // Будет захеширован автоматически
      username: process.env.ADMIN_USERNAME || "superadmin",
      firstName: process.env.ADMIN_FIRST_NAME || "Super",
      lastName: process.env.ADMIN_LAST_NAME || "Admin",
      provider: "local", // Локальная регистрация
      role: USER_ROLES.ADMIN,
      isActive: true,
      isEmailVerified: true, // Админ сразу верифицирован
      isVerified: true, // Старое поле для совместимости
      bio: "Системный администратор форума",
      roleChangedAt: new Date(),
      roleChangedBy: null, // Первый админ создается системой
    };

    // Проверяем, существует ли уже админ с таким email
    const existingAdmin = await User.findOne({ email: adminData.email });

    if (existingAdmin) {
      console.log(`⚠️  Пользователь с email ${adminData.email} уже существует`);

      // Если пользователь существует, но не админ - делаем его админом
      if (existingAdmin.role !== USER_ROLES.ADMIN) {
        const oldRole = existingAdmin.role;
        existingAdmin.role = USER_ROLES.ADMIN;
        existingAdmin.roleChangedAt = new Date();
        existingAdmin.isActive = true;
        existingAdmin.isEmailVerified = true;
        existingAdmin.isVerified = true;

        await existingAdmin.save();

        console.log(
          `✅ Пользователь ${adminData.email} повышен до администратора`
        );
        console.log(`📧 Email: ${existingAdmin.email}`);
        console.log(`👤 Username: ${existingAdmin.username}`);
        console.log(`🆔 ID: ${existingAdmin._id}`);
        console.log(`🔄 Роль изменена: ${oldRole} -> ${USER_ROLES.ADMIN}`);
      } else {
        console.log(
          `✅ Пользователь ${adminData.email} уже является администратором`
        );
        console.log(`📧 Email: ${existingAdmin.email}`);
        console.log(`👤 Username: ${existingAdmin.username}`);
        console.log(`🆔 ID: ${existingAdmin._id}`);
      }
    } else {
      // Создаем нового суперадмина
      const newAdmin = new User(adminData);
      await newAdmin.save();

      console.log("🎉 Суперадмин успешно создан!");
      console.log(`📧 Email: ${newAdmin.email}`);
      console.log(`👤 Username: ${newAdmin.username || "не указан"}`);
      console.log(`🆔 ID: ${newAdmin._id}`);
      console.log(`🔑 Пароль: ${process.env.ADMIN_PASSWORD || "admin123456"}`);
      console.log(`📝 Provider: ${newAdmin.provider}`);
      console.log(`✅ Email верифицирован: ${newAdmin.isEmailVerified}`);
    }

    // Проверяем общее количество администраторов
    const adminCount = await User.countDocuments({ role: USER_ROLES.ADMIN });
    const totalUsers = await User.countDocuments();

    console.log("\n📊 Статистика:");
    console.log(`   Администраторов: ${adminCount}`);
    console.log(`   Всего пользователей: ${totalUsers}`);

    // Показываем всех админов
    const allAdmins = await User.find({ role: USER_ROLES.ADMIN })
      .select("email username provider isEmailVerified isActive createdAt")
      .sort({ createdAt: 1 });

    console.log("\n👥 Список всех администраторов:");
    allAdmins.forEach((admin, index) => {
      console.log(
        `   ${index + 1}. ${admin.email} (${
          admin.username || "без username"
        }) - ${admin.provider} - ${
          admin.isEmailVerified ? "верифицирован" : "не верифицирован"
        }`
      );
    });

    console.log("\n🚀 Теперь можно войти в систему используя:");
    console.log(`   Email: ${adminData.email}`);
    console.log(`   Пароль: ${adminData.password}`);
    console.log(`   Метод: POST /api/auth/login`);
  } catch (error) {
    console.error("❌ Ошибка при создании админа:", error.message);

    // Более детальная информация об ошибке
    if (error.code === 11000) {
      console.error(
        "   Причина: Пользователь с таким email или username уже существует"
      );
    } else if (error.name === "ValidationError") {
      console.error("   Причина: Ошибка валидации данных");
      Object.keys(error.errors).forEach((field) => {
        console.error(`   - ${field}: ${error.errors[field].message}`);
      });
    }

    process.exit(1);
  } finally {
    // Закрываем подключение к БД
    await mongoose.connection.close();
    console.log("\n📦 Соединение с MongoDB закрыто");
    process.exit(0);
  }
};

// Функция для создания тестового пользователя (опционально)
const createTestUser = async () => {
  try {
    const testUserData = {
      email: "test@example.com",
      password: "password123",
      username: "testuser",
      firstName: "Test",
      lastName: "User",
      provider: "local",
      role: USER_ROLES.USER,
      isActive: true,
      isEmailVerified: true, // Для удобства тестирования
      isVerified: true,
    };

    const existingTestUser = await User.findOne({ email: testUserData.email });

    if (!existingTestUser) {
      const testUser = new User(testUserData);
      await testUser.save();
      console.log(`✅ Тестовый пользователь создан: ${testUserData.email}`);
    } else {
      console.log(
        `ℹ️  Тестовый пользователь уже существует: ${testUserData.email}`
      );
    }
  } catch (error) {
    console.error(
      "❌ Ошибка при создании тестового пользователя:",
      error.message
    );
  }
};

// Проверяем аргументы командной строки
const args = process.argv.slice(2);
const createTestUserFlag = args.includes("--with-test-user");

const runScript = async () => {
  await createSuperAdmin();

  if (createTestUserFlag) {
    console.log("\n🧪 Создание тестового пользователя...");
    await createTestUser();
  }
};

// Запускаем скрипт
runScript();

// Экспортируем функцию для использования в других скриптах
export { createSuperAdmin, createTestUser };
