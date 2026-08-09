# Registra la tarea programada de ingesta AUTONOMA de SOEC (Growth + Google Ads, READ ONLY).
#
# Corrige el fallo desatendido `0x800710E0` ("el operador/administrador ha rehusado la solicitud"):
# la causa raiz era la condicion de energia por defecto (no iniciar / detener en modo BATERIA), que hacia
# que el Programador de tareas REHUSARA las corridas programadas cuando el equipo estaba en bateria.
# Este registro permite bateria (AllowStartIfOnBatteries + DontStopIfGoingOnBatteries), habilita
# StartWhenAvailable (recupera corridas perdidas), limita la duracion e ignora instancias solapadas.
#
# Corre SOLO cuando el usuario tiene la sesion iniciada (no se almacena contrasena; regimen local). El
# launcher `ingesta-tick.cmd` usa node absoluto + tsx local (sin npx) y registra un log sanitizado.
# Idempotente (-Force). Ejecutar:  powershell -ExecutionPolicy Bypass -File scripts\registrar-tarea-ingesta.ps1

$root = (Resolve-Path "$PSScriptRoot\..").Path
$cmd  = Join-Path $root 'scripts\ingesta-tick.cmd'

$act = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$cmd`""
$trg = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(2)) `
        -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Days 3650)
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName 'SOEC-Ingesta-Observacion' -Action $act -Trigger $trg -Settings $set -Force
