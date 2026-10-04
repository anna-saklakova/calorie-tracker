# Настройка Supabase для Calorie tracker

Делается один раз в дашборде Supabase (проект `gcpctajvplyvpqwrjond`). Код для этого менять не нужно.

Прод: https://calorie-tracker-cyan-six.vercel.app

## 0. Таблица и права

**SQL Editor**: запусти `supabase/migrations/20261003000000_user_data.sql` (таблица + RLS + права). Если таблица уже есть, достаточно `20261004000000_user_data_grants.sql`. Без прав приложение пишет «Couldn’t load your data · permission denied for table user_data».

---

## 1. Вход по email и паролю

**Authentication → Sign In / Providers → Email**

- **Enable Email provider**: ON
- **Confirm email**: ON. Это обязательно: пока email не подтверждён, войти нельзя. Именно подтверждение позволяет Supabase склеить вход через Google и по паролю в один аккаунт.
- **Minimum password length**: 8 (приложение тоже требует 8)
- **Secure password change**: ON (по желанию)

## 2. Один email — один аккаунт

Supabase делает это сам (automatic identity linking): если человек входит через Google с email, который уже есть и подтверждён, вход привязывается к тому же пользователю. Данные хранятся по `user_id`, поэтому лог один и тот же.

- Сначала зарегистрировалась по паролю, потом вошла через Google: тот же аккаунт.
- Сначала Google, потом хочешь пароль: **Settings → Set a password** в приложении или «Forgot password?» на экране входа. Аккаунт тот же.

Ничего включать не нужно, это поведение по умолчанию.

## 3. Адреса для редиректов

**Authentication → URL Configuration**

- **Site URL**: `https://calorie-tracker-cyan-six.vercel.app`
- **Redirect URLs** (добавить все три):
  - `https://calorie-tracker-cyan-six.vercel.app/**`
  - `http://localhost:5173/**`
  - `https://calorie-tracker-*-anna-saklakova.vercel.app/**` (превью-деплои Vercel)

Без этого ссылки из писем (подтверждение, сброс пароля) будут вести не туда.

## 4. Текст писем с «Calorie tracker»

**Authentication → Emails → Templates**

Для каждого шаблона заполни **Subject** и замени **Body** (вкладка Source) на содержимое файла из `supabase/email-templates/`:

| Шаблон в Supabase | Subject | Файл |
|---|---|---|
| Confirm signup | `Confirm your Calorie tracker account` | `confirm-signup.html` |
| Reset password | `Reset your Calorie tracker password` | `reset-password.html` |
| Change email address | `Confirm your new Calorie tracker email` | `change-email.html` |

Шаблон Magic link больше не используется: в приложении его нет.

## 5. Отправитель письма (имя и адрес) — нужен свой SMTP

Шаблоны меняют только текст. Отправитель останется «Supabase Auth &lt;noreply@mail.app.supabase.io&gt;», пока не подключён свой SMTP. Есть и второе ограничение: **встроенная почта Supabase отправляет письма только адресам участников команды проекта** и всего несколько штук в час. Чужие люди просто не получат письмо подтверждения и не смогут зарегистрироваться. Поэтому для реальных пользователей свой SMTP всё равно нужен.

**Authentication → Emails → SMTP Settings → Enable Custom SMTP**

### Вариант А — Resend (лучше, нужен свой домен)
1. Зарегистрируйся на resend.com (бесплатно до 3 000 писем в месяц).
2. **Domains → Add domain**: добавь свой домен и пропиши DNS-записи, которые покажет Resend. Без своего домена Resend шлёт письма только тебе самой.
3. **API Keys → Create** (права: Sending access).
4. В Supabase:
   - Sender email: `hello@твой-домен`
   - Sender name: `Calorie tracker`
   - Host: `smtp.resend.com`, Port: `465`
   - Username: `resend`
   - Password: API-ключ Resend

### Вариант Б — Gmail (быстро, без домена)
1. В Google-аккаунте включи двухэтапную проверку, затем создай **App password** (myaccount.google.com → Security → App passwords).
2. В Supabase:
   - Sender email: твой gmail
   - Sender name: `Calorie tracker`
   - Host: `smtp.gmail.com`, Port: `465`
   - Username: твой gmail
   - Password: app password (16 символов)

Письма будут приходить от «Calorie tracker &lt;твой gmail&gt;». Для личного трекера этого достаточно.

После подключения SMTP загляни в **Authentication → Rate Limits** и подними лимит писем в час, если нужно.

## 6. Google-вход

**Authentication → Sign In / Providers → Google**: должен быть ON (уже настроен).

На экране выбора аккаунта Google показывает название приложения из Google Cloud. Проверь **Google Cloud Console → APIs & Services → OAuth consent screen (Branding) → App name** = `Calorie tracker`. Строка «to continue to gcpctajvplyvpqwrjond.supabase.co» убирается только платным custom domain в Supabase, это необязательно.

## 7. Очистка тестовых данных (один раз)

Только **после** деплоя новой версии: она стирает старые локальные копии на устройствах, и они не всплывут.

**SQL Editor** → вставить и запустить `supabase/reset-all-users.sql`:

```sql
delete from auth.users;   -- строки user_data удалятся каскадом
```

Это **необратимо**: удаляются все аккаунты и все записи. Можно и вручную: **Authentication → Users → выбрать всех → Delete users**.

## Проверка после настройки

1. Открыть прод в режиме инкогнито: виден только экран входа.
2. Create account с паролем, затем письмо от «Calorie tracker», Confirm, и ты внутри.
3. Добавить еду, обновить страницу: еда на месте.
4. Sign out, затем Continue with Google с тем же email: та же еда.
5. Sign out, затем Forgot password: письмо, новый пароль, вход по нему.
6. Settings → Export data: скачивается JSON.
