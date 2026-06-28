# FUTURCS PRO LEAGUE — Deploy Guide

## Структура проекта
```
futurcs/
├── src/server.js      ← бэкенд (Node.js + Express)
├── public/index.html  ← твой сайт (уже подключён к API)
├── package.json
└── railway.toml
```

---

## Деплой на Railway (10 минут)

### Шаг 1 — Загрузи на GitHub
1. Иди на github.com → New repository
2. Назови: `futurcs-pro-league`
3. Создай (без README)
4. Загрузи все файлы из этой папки

### Шаг 2 — Подключи к Railway
1. Зайди на railway.app
2. New Project → Deploy from GitHub repo
3. Выбери `futurcs-pro-league`

### Шаг 3 — Добавь PostgreSQL
1. В проекте нажми `+ Add Service`
2. Выбери `Database` → `PostgreSQL`
3. Railway автоматически добавит DATABASE_URL

### Шаг 4 — Переменные окружения
В Railway → твой сервис → Variables → добавь:

```
STEAM_API_KEY=1FA1A98259C20EBFF1F749AD772CF870
SESSION_SECRET=futurcs-super-secret-2024-change-me
JWT_SECRET=futurcs-jwt-2024-change-me
NODE_ENV=production
BASE_URL=https://ТВОЙ-ДОМЕН.up.railway.app
```

> BASE_URL узнаешь после первого деплоя (Settings → Domains)

### Шаг 5 — Deploy!
Railway сам запустит `npm install` и `npm start`.
Через 2-3 минуты сайт живой!

---

## Что работает после деплоя
- ✅ Регистрация через email + пароль
- ✅ Вход через Steam (OpenID)
- ✅ База данных игроков (PostgreSQL)
- ✅ Живая статистика на главной
- ✅ Лидерборд (/api/leaderboard)
- ✅ Вейтлист (сохраняет email в БД)
- ✅ Сессии сохраняются 30 дней

## API endpoints
| Метод | URL | Описание |
|-------|-----|----------|
| GET | /auth/steam | Войти через Steam |
| POST | /api/register | Регистрация |
| POST | /api/login | Вход |
| GET | /api/me | Профиль (нужен токен) |
| GET | /api/leaderboard | Топ-50 игроков |
| GET | /api/stats | Общая статистика |
| POST | /api/waitlist | Добавить email в список |
