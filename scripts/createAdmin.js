// scripts/createAdmin.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../models/User.js";
import RoleChange from "../models/RoleChange.js";
import { USER_ROLES } from "../utils/constants.js";
import { logRoleChange } from "../middlewares/logger.js";

// Загружаем переменные окружения
dotenv.config();

const createSuperAdmin = async () => {
  try {
    // Подключение к базе данных
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("📦 Подключен к MongoDB");

    // Данные суперадмина (можно передавать через переменные окружения или аргументы)
    const adminData = {
      email: process.env.ADMIN_EMAIL || "admin@fastcredit.sk",
      username: process.env.ADMIN_USERNAME || "superadmin",
      firstName: "Super",
      lastName: "Admin",
      role: USER_ROLES.ADMIN,
      isActive: true,
      isEmailVerified: true,
      isFirstLogin: false,
      canModerate: true,
      bio: "Системный администратор форума",
      createdAt: new Date(),
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
        existingAdmin.canModerate = true;

        await existingAdmin.save();

        // Записываем изменение роли в историю
        await RoleChange.logRoleChange(
          existingAdmin._id,
          oldRole,
          USER_ROLES.ADMIN,
          null, // системная операция
          "Promoted to super admin via seed script"
        );

        // Логируем в файл
        logRoleChange(
          existingAdmin._id,
          oldRole,
          USER_ROLES.ADMIN,
          "SYSTEM_SEED"
        );

        console.log(
          `✅ Пользователь ${adminData.email} повышен до администратора`
        );
        console.log(`📧 Email: ${existingAdmin.email}`);
        console.log(`👤 Username: ${existingAdmin.username}`);
        console.log(`🔑 ID: ${existingAdmin._id}`);
      } else {
        console.log(
          `✅ Пользователь ${adminData.email} уже является администратором`
        );
      }
    } else {
      // Создаем нового суперадмина
      const newAdmin = new User(adminData);
      await newAdmin.save();

      // Записываем создание в историю ролей
      await RoleChange.logRoleChange(
        newAdmin._id,
        null, // не было предыдущей роли
        USER_ROLES.ADMIN,
        null, // системная операция
        "Initial super admin creation via seed script"
      );

      // Логируем создание
      logRoleChange(newAdmin._id, "none", USER_ROLES.ADMIN, "SYSTEM_SEED");

      console.log("🎉 Суперадмин успешно создан!");
      console.log(`📧 Email: ${newAdmin.email}`);
      console.log(`👤 Username: ${newAdmin.username}`);
      console.log(`🔑 ID: ${newAdmin._id}`);
    }

    // Проверяем общее количество администраторов
    const adminCount = await User.countDocuments({ role: USER_ROLES.ADMIN });
    console.log(`📊 Общее количество администраторов: ${adminCount}`);
  } catch (error) {
    console.error("❌ Ошибка при создании админа:", error.message);
    process.exit(1);
  } finally {
    // Закрываем подключение к БД
    await mongoose.connection.close();
    console.log("📦 Соединение с MongoDB закрыто");
    process.exit(0);
  }
};

// Запускаем скрипт
createSuperAdmin();
