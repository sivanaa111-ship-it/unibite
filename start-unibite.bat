@echo off
REM Double-click this file to start UniBite from THIS folder.
cd /d "%~dp0"
title UniBite server
if not exist node_modules (
  echo Installing packages for the first time...
  call npm install
)
if not exist data\unibite.db (
  echo Creating the database with demo data...
  call npm run seed:reset
)
echo.
echo UniBite version check: student login link enabled
echo Open http://localhost:3000 in your browser. Keep this window open.
echo Close this window to stop the server.
echo.
start "" http://localhost:3000/student/login
call npm start
pause
