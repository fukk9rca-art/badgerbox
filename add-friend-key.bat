@echo off
title badgerbox access key
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist "keys.json" copy "keys.example.json" "keys.json" >nul
echo.
echo  Make an access key for a friend
echo  --------------------------------
set "BBNAME="
set /p "BBNAME=  their first name: "
set "BBRUNS="
set /p "BBRUNS=  worksheets per day (press Enter for 5): "
if "%BBRUNS%"=="" set "BBRUNS=5"
set "BBOWN="
set /p "BBOWN=  key to give them (press Enter for a random one): "
node tools\addkey.mjs "%BBNAME%" "%BBRUNS%" "%BBOWN%"
echo.
pause
exit /b

:nonode
echo.
echo  badgerbox needs Node.js. Double-click start-badgerbox.bat first.
echo.
pause
