# SOEC — runtime local persistente

Deja SOEC (API 3081 + web 3080) levantado en local de forma persistente, sin terminal visible y sin
depender de Claude Code. **No cambia lógica de producto**: sólo orquesta procesos que ya existen
(mismo `apps/api/src/server.ts` y `next start` que `start-soec.mjs`).

## Uso

Registrar la tarea una sola vez:

```
powershell -ExecutionPolicy Bypass -File scripts\registrar-tarea-runtime.ps1
```

Desde entonces, al **iniciar sesión de Windows** la tarea `SOEC-Runtime` levanta el stack sola.
Abrir en el navegador:

```
http://localhost:3080/resultados
```

## Qué hace

- `scripts/soec-runtime.mjs` — **supervisor**: guard anti-duplicado (puertos), espera a Docker,
  levanta PostgreSQL (`docker compose -p soec`), aplica migraciones (idempotente), sirve la web
  compilada (`next start`, usa `apps/web/.next`; compila sólo si falta) y el API; **reinicia** API/web
  si caen. Log local sanitizado en `soec-runtime.log` (gitignored).
- `scripts/soec-runtime.cmd` — wrapper (node absoluto + supervisor; tsx/next locales, sin npx).
- `scripts/soec-runtime-hidden.vbs` — lanzador **oculto** (sin ventana de consola).
- `scripts/registrar-tarea-runtime.ps1` — registra `SOEC-Runtime` (AtLogOn, StartWhenAvailable,
  batería permitida, IgnoreNew, restart-on-failure, ejecución ilimitada, usuario actual sin contraseña).

## Tareas separadas

- `SOEC-Runtime` — este runtime (API + web).
- `SOEC-Ingesta-Observacion` — ingesta autónoma (Growth + Google Ads, READ ONLY), independiente.

## Único requisito

Docker Desktop debe estar instalado y con **inicio automático** (ya configurado en este equipo). El
supervisor espera a que el daemon esté disponible tras el login antes de levantar PostgreSQL.

## Operación manual

- Ver estado: `Get-ScheduledTask SOEC-Runtime`
- Forzar arranque: `Start-ScheduledTask SOEC-Runtime`
- Detener: `Stop-ScheduledTask SOEC-Runtime` (o cerrar los procesos node)
