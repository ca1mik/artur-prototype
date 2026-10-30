# Исправление кодирования русского текста в Telegram боте

## Проблема

В файле `backend/src/bot/bot.ts` обнаружены строки с Unicode escape sequences (например, `\u041e`, `\u0442` и т.д.), которые являются закодированными Cyrillic символами. Это приводит к проблемам с отображением русского текста в Telegram.

**Пример проблемы:**
```
\u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c  →  Отменить
\u043c\u0438\u043d  →  мин
```

Вместо нормального русского текста пользователь видит: `Р В Р"РР"Р Р` (как на скриншоте в Telegram)

## Решение

### Вариант 1: Используя Node.js (Рекомендуется)

```bash
# Из корня проекта
node fix-unicode.js
```

Скрипт автоматически:
1. Прочитает файл `backend/src/bot/bot.ts`
2. Заменит все `\uXXXX` на соответствующие Unicode символы
3. Сохранит файл с правильной кодировкой UTF-8

**Вывод:**
```
✅ All Unicode escape sequences fixed!
```

### Вариант 2: Используя npm (если вы в каталоге backend)

```bash
cd backend
npm run fix:unicode
```

## Что было исправлено вручную

Следующие строки уже исправлены с помощью редактора:

1. **CANCEL_TEXT** (`backend/src/bot/bot.ts`, строка 81)
   - Было: `const CANCEL_TEXT = "\u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c";`
   - Стало: `const CANCEL_TEXT = "Отменить";`

2. **BACK_TEXT** (`backend/src/bot/bot.ts`, строка 82)
   - Было: `const BACK_TEXT = "\u041d\u0430\u0437\u0430\u0434";`
   - Стало: `const BACK_TEXT = "Назад";`

3. **buildEtaKeyboard** (`backend/src/bot/bot.ts`, строка 213)
   - Было: `[{ text: "15 \u043c\u0438\u043d" }, ...]`
   - Стало: `[{ text: "15 мин" }, ...]`

4. **buildCommentKeyboard** (`backend/src/bot/bot.ts`, строка 196)
   - Было: `keyboard: [[{ text: "\u041d\u0435\u0442" }], ...]`
   - Стало: `keyboard: [[{ text: "Нет" }], ...]`

5. **CALENDAR_WEEKDAY_NAMES** (`backend/src/bot/bot.ts`, строка 347)
   - Было: `const CALENDAR_WEEKDAY_NAMES = ["\u041f\u043d", "\u0412\u0442", ...];`
   - Стало: `const CALENDAR_WEEKDAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];`

6. **parseEtaInput** (`backend/src/bot/bot.ts`, строка 336)
   - Было: `return \`${normalized} \u043c\u0438\u043d\`;`
   - Стало: ``return `${normalized} мин`;``

## Остальные строки

В файле остаются сотни других закодированных строк, которые будут исправлены скриптом `fix-unicode.js`:
- Сообщения пользователям
- Текст кнопок меню
- Подсказки и инструкции

## Проверка

После исправления проверьте, что текст в Telegram боте отображается правильно:

```bash
# Запустите бота
npm run dev
```

Все русские тексты должны отображаться корректно вместо `Р В Р"РР"Р`.

## Техническая информация

- **Кодировка:** UTF-8
- **Формат escape:** Unicode escape sequences (`\uXXXX`)
- **Язык:** Cyrillic (Русский)
- **Инструмент:** Node.js встроенный `String.fromCharCode()`

## Дополнительно

Если вы видите подобные проблемы в других файлах проекта, вы можете создать аналогичный скрипт для их исправления. Основной паттерн для замены:

```javascript
content = content.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
  return String.fromCharCode(parseInt(hex, 16));
});
```
