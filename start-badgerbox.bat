@echo off
title badgerbox
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

if not exist "keys.json" copy "keys.example.json" "keys.json" >nul
if exist ".env" goto run

echo.
echo  badgerbox setup (first time only)
echo  ---------------------------------
echo  Paste your Claude API key (it starts with sk-ant-) and press Enter.
echo  To use the sample answers for now, just press Enter.
echo.
set "BBKEY="
set /p "BBKEY=  key: "
if "%BBKEY%"=="" goto run
>".env" echo ANTHROPIC_API_KEY=%BBKEY%
echo.
echo  Saved to the .env file in this folder. Delete that file to enter a different key.

:run
echo.
set BADGERBOX_OPEN=1
node tools\serve.mjs
echo.
pause
exit /b

:nonode
echo.
echo  badgerbox needs Node.js, which is not installed on this computer yet.
echo  1. A download page will open. Get the "LTS" Windows installer and run it.
echo  2. Then double-click start-badgerbox.bat again.
echo.
start "" "https://nodejs.org/en/download"
pause
