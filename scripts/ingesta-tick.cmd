@echo off
REM SOEC - lanzador de la ingesta autonoma (Growth + Google Ads, READ ONLY).
REM Lo invoca la tarea programada de Windows cada N minutos, SIN Claude Code abierto ni sesion interactiva.
REM Robustez desatendida: usa node absoluto + tsx LOCAL (sin npx, que puede colgarse pidiendo confirmacion),
REM fija working dir, y registra un log SANITIZADO (el one-shot imprime resumen sin secretos).
REM Los secretos y DATABASE_URL se cargan desde .env.google-ads (gitignored) dentro del one-shot.
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"
set "NODE=C:\Program Files\nodejs\node.exe"
set "TSX=%ROOT%\node_modules\tsx\dist\cli.mjs"
set "LOG=%ROOT%\ingesta-autonoma.log"
echo [%date% %time%] INICIO ingesta autonoma>> "%LOG%"
"%NODE%" "%TSX%" "%ROOT%\apps\api\scripts\ingest-all.ts">> "%LOG%" 2>&1
echo [%date% %time%] FIN exit=%ERRORLEVEL%>> "%LOG%"
endlocal
