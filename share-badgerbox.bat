@echo off
title badgerbox share link
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist ".env" goto noenv
if not exist "keys.json" copy "keys.example.json" "keys.json" >nul
where cloudflared >nul 2>nul
if errorlevel 1 goto nocf

echo.
echo  Sharing badgerbox from this computer.
echo  If badgerbox is already open in another black window, close that one first.
node tools\share.mjs
echo.
pause
exit /b

:nocf
echo.
echo  Sharing needs a free tool called cloudflared (made by Cloudflare).
echo  It makes the private link to this computer. Nothing is uploaded.
echo.
set "BBOK="
set /p "BBOK=  Install it now? type y and press Enter: "
if /i not "%BBOK%"=="y" goto end
winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
echo.
echo  Done. Close this window and double-click share-badgerbox.bat again.
echo  If it asks to install again, restart the computer once first.
goto end

:noenv
echo.
echo  Set badgerbox up first: double-click start-badgerbox.bat and paste your API key.
goto end

:nonode
echo.
echo  badgerbox needs Node.js. Double-click start-badgerbox.bat first, it will help you install it.

:end
echo.
pause
