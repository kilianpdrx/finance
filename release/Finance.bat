@echo off
REM Finance - double-cliquez ce fichier pour ouvrir l'application.
REM Il telecharge la derniere version, la demarre, puis ouvre votre navigateur.
REM C'est aussi comme ca que les mises a jour arrivent : il suffit de relancer.

cd /d "%~dp0"
title Finance
echo Finance
echo Demarrage...
echo.

REM 1. Docker installe ?
where docker >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Docker n'est pas installe.
  echo   Cette application a besoin de Docker Desktop ^(gratuit^) pour fonctionner.
  echo.
  echo   1. Telechargez-le ici : https://www.docker.com/products/docker-desktop/
  echo   2. Installez-le, ouvrez-le une fois.
  echo   3. Double-cliquez a nouveau sur Finance.
  echo.
  pause
  exit /b 1
)

REM 2. Docker demarre ? (installe mais pas lance = cas le plus frequent)
docker info >nul 2>&1
if errorlevel 1 (
  echo   Docker Desktop n'est pas encore demarre - tentative d'ouverture...
  start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" >nul 2>&1
  for /l %%i in (1,1,60) do (
    timeout /t 2 /nobreak >nul
    docker info >nul 2>&1 && goto :docker_ready
  )
  echo.
  echo   Docker Desktop ne repond pas.
  echo   Ouvrez Docker Desktop manuellement, attendez qu'il indique "running",
  echo   puis double-cliquez a nouveau sur Finance.
  echo.
  pause
  exit /b 1
)
:docker_ready

REM 3. Derniere version (mecanisme de mise a jour).
echo   Recherche d'une mise a jour...
docker compose pull --quiet >nul 2>&1
if errorlevel 1 docker compose pull

REM 4. Demarrage.
docker compose up -d
if errorlevel 1 (
  echo.
  echo   L'application n'a pas pu demarrer.
  echo   Si le port 3000 est deja utilise par un autre programme, fermez-le puis reessayez.
  echo.
  pause
  exit /b 1
)

REM 5. Attendre que ce soit pret avant d'ouvrir le navigateur.
echo   Preparation...
for /l %%i in (1,1,60) do (
  timeout /t 2 /nobreak >nul
  curl -fs -m 2 http://127.0.0.1:3000/api/health >nul 2>&1 && goto :ready
)

echo.
echo   L'application a demarre mais ne repond pas.
echo   Reessayez dans une minute. Si le probleme persiste, double-cliquez sur "Arreter",
echo   puis relancez Finance.
echo.
pause
exit /b 1

:ready
start "" "http://127.0.0.1:3000"
echo.
echo   Finance est ouvert dans votre navigateur.
echo   Adresse : http://127.0.0.1:3000
echo.
echo   Pour arreter l'application : double-cliquez sur "Arreter".
echo   Vous pouvez fermer cette fenetre.
echo.
timeout /t 8 /nobreak >nul
