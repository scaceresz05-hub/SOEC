' SOEC-Runtime — lanzador OCULTO (sin ventana de consola).
' Ejecuta soec-runtime.cmd con estilo de ventana 0 (oculto) y ESPERA (True), de modo que la tarea
' SOEC-Runtime permanezca "en ejecucion" mientras el supervisor vive (habilita IgnoreNew y
' restart-on-failure del Programador de tareas). Sin terminal visible.
Dim sh, fso, here
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c """ & here & "\soec-runtime.cmd""", 0, True
