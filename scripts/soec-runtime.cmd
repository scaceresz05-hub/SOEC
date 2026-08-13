@echo off
REM SOEC-Runtime — supervisor de runtime local persistente (API 3081 + web 3080).
REM Lo invoca la tarea SOEC-Runtime (AtLogOn) a traves del lanzador oculto soec-runtime-hidden.vbs,
REM SIN Claude Code abierto ni terminal visible. node absoluto + supervisor (tsx/next locales, sin npx).
REM Propaga el exit real para que Task Scheduler pueda aplicar restart-on-failure.
setlocal
set "ROOT=%~dp0.."
cd /d "%ROOT%"
set "NODE=C:\Program Files\nodejs\node.exe"
"%NODE%" "%ROOT%\scripts\soec-runtime.mjs"
endlocal & exit /b %ERRORLEVEL%
