@echo off
chcp 65001 >nul
title MATN Pull-Worker WhatsApp Bot
cd /d "%~dp0"

if not exist ".env" (
  echo [!] ملف .env غير موجود داخل مجلد whatsapp-bot
  echo     انسخ .env.example إلى .env وضع فيه PLATFORM_URL و BOT_PULL_TOKEN أولاً.
  if exist ".env.example" (
    copy /Y ".env.example" ".env" >nul
    echo     تم إنشاء .env تلقائياً من .env.example — يرجى تعديله ثم إعادة التشغيل.
    notepad ".env"
  )
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
)

echo Opening MATN Bot status & QR page at http://127.0.0.1:4001/
start "" http://127.0.0.1:4001/
node index.js
pause
