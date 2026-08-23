@echo off
REM Arreter Finance - double-cliquez ce fichier pour fermer l'application.
REM Vos donnees sont conservees dans le dossier "data".

cd /d "%~dp0"
title Arreter Finance
echo Arret de Finance...
echo.

where docker >nul 2>&1
if errorlevel 1 goto :already_stopped
docker info >nul 2>&1
if errorlevel 1 goto :already_stopped

docker compose down

echo.
echo   Finance est arrete. Vos donnees sont conservees.
echo   Pour rouvrir l'application : double-cliquez sur "Finance".
echo.
timeout /t 6 /nobreak >nul
exit /b 0

:already_stopped
echo   Docker n'est pas demarre - l'application est deja arretee.
timeout /t 5 /nobreak >nul
