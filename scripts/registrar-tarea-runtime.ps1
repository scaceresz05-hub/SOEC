# Registra la tarea programada SOEC-Runtime: deja SOEC (API 3081 + web 3080) levantado de forma
# PERSISTENTE en local, sin terminal visible y sin depender de Claude Code.
#
# - Trigger AtLogOn: arranca al iniciar sesion de Windows.
# - StartWhenAvailable: recupera el arranque si el equipo no estaba disponible.
# - Bateria permitida (AllowStartIfOnBatteries + DontStopIfGoingOnBatteries).
# - MultipleInstances IgnoreNew: no duplica el stack (ademas del guard de puertos del supervisor).
# - ExecutionTimeLimit 0 (ilimitado): el supervisor es un proceso de larga duracion.
# - RestartCount/Interval: si el supervisor cae, el Programador lo reintenta.
# - Corre como el usuario actual, interactivo, SIN almacenar contrasena (regimen local).
# - Accion: lanzador OCULTO (wscript soec-runtime-hidden.vbs) -> soec-runtime.cmd -> soec-runtime.mjs.
#
# Separada e independiente de SOEC-Ingesta-Observacion (la ingesta no se toca).
# Idempotente (-Force). Ejecutar:  powershell -ExecutionPolicy Bypass -File scripts\registrar-tarea-runtime.ps1

$root = (Resolve-Path "$PSScriptRoot\..").Path
$vbs  = Join-Path $root 'scripts\soec-runtime-hidden.vbs'
$me   = "$env:USERDOMAIN\$env:USERNAME"

# Principal EXPLICITO del usuario actual (interactivo, sin elevacion, sin contrasena almacenada):
# evita "Acceso denegado" al registrar un disparador AtLogOn y mantiene el regimen local.
$prin = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited

$act = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B //Nologo `"$vbs`"" -WorkingDirectory $root
$trg = New-ScheduledTaskTrigger -AtLogOn -User $me
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -StartWhenAvailable -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName 'SOEC-Runtime' -Action $act -Trigger $trg -Settings $set -Principal $prin -Force | Out-Null
Write-Output 'SOEC-Runtime registrada.'
