@echo off
setlocal
cd /d "%~dp0"
call npm start
if errorlevel 1 (
  echo.
  echo App failed to start. See the error above.
  pause
  exit /b 1
)
