@echo off
REM SOEC · lanzador de la ingesta autónoma (Growth + Google Ads, READ ONLY).
REM Lo invoca la tarea programada de Windows cada N minutos, SIN Claude Code abierto.
REM No contiene secretos: el one-shot los carga desde .env.google-ads (gitignored) y DATABASE_URL de ahí.
cd /d "%~dp0.."
call npx tsx apps/api/scripts/ingest-all.ts
