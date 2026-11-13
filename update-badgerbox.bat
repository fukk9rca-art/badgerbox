@echo off
title badgerbox update
cd /d "%~dp0"
echo.
echo  Getting the latest badgerbox from GitHub...
curl -L -s -f -o "%TEMP%\badgerbox-latest.zip" "https://github.com/fukk9rca-art/badgerbox/archive/refs/heads/master.zip"
if errorlevel 1 goto fail
if exist "%TEMP%\badgerbox-master" rmdir /s /q "%TEMP%\badgerbox-master"
tar -xf "%TEMP%\badgerbox-latest.zip" -C "%TEMP%"
if errorlevel 1 goto fail
xcopy "%TEMP%\badgerbox-master\*" "%~dp0" /E /Y /Q >nul
if errorlevel 1 goto fail
rmdir /s /q "%TEMP%\badgerbox-master"
del "%TEMP%\badgerbox-latest.zip"
echo.
echo  Updated. Your API key, access keys and limits were not touched.
echo  Close any open badgerbox window, then double-click start-badgerbox.bat.
echo.
pause
exit /b

:fail
echo.
echo  The update did not work. Check your internet connection and try again.
echo.
pause
