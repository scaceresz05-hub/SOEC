@echo off
REM SOEC - lanzador de la ingesta autonoma (Growth + Google Ads, READ ONLY).
REM Lo invoca la tarea programada de Windows cada N minutos, SIN Claude Code abierto ni sesion interactiva.
REM Robustez desatendida: usa node absoluto + tsx LOCAL (sin npx, que puede colgarse pidiendo confirmacion),
REM fija working dir, y registra un log SANITIZADO (el one-shot imprime resumen sin secretos).
REM Los secretos y DATABASE_URL se cargan desde .env.google-ads (gitignored) dentro del one-shot.
REM
REM OBSERVABILIDAD: propaga el codigo de salida real del one-shot a Task Scheduler (LastResult) para NO
REM enmascarar fallos. Codigos: 0=GLOBAL_OK  3=PARTIAL_FAILURE  2=TOTAL_FAILURE  1=INFRA_ERROR (DB/env).
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"
set "NODE=C:\Program Files\nodejs\node.exe"
set "TSX=%ROOT%\node_modules\tsx\dist\cli.mjs"
set "LOG=%ROOT%\ingesta-autonoma.log"
echo [%date% %time%] INICIO ingesta autonoma>> "%LOG%"
"%NODE%" "%TSX%" "%ROOT%\apps\api\scripts\ingest-all.ts">> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
set "EST=INFRA_ERROR"
if "%RC%"=="0" set "EST=GLOBAL_OK"
if "%RC%"=="3" set "EST=PARTIAL_FAILURE"
if "%RC%"=="2" set "EST=TOTAL_FAILURE"
echo [%date% %time%] FIN exit=%RC% estado=%EST%>> "%LOG%"
endlocal & exit /b %RC%
