# Informe del Sprint 0 — plantilla (a completar tras una ronda completa)

> **Modo de apoyo.** Durante las sesiones NO se modifica la experiencia ni los motores.
> No se corrige nada hasta cerrar una ronda completa, salvo **bloqueo crítico** (la sesión
> no puede continuar). Cada corrección posible se registra como hallazgo y se decide
> **después**. La gobernabilidad y la auditabilidad se **observan**, no se presumen.

## Datos de la ronda

- Fechas: __________  · Nº de participantes: ____ (objetivo: 5)
- Versión del producto (huella de rubro / commit si aplica): __________
- Escenarios usados: A ☐  B ☐  C ☐  · evaluación nueva ☐
- Facilitador(es): __________

---

## 1. Registro de incidentes técnicos (durante las sesiones)

Solo fallas del entorno/software (errores de API, caídas, estados corruptos), no dudas del
usuario. Si Claude está conectado durante las sesiones, puede vigilar los logs de API/Web y
anotar aquí lo observado.

| # | Momento | Participante | Qué ocurrió | Log/evidencia | ¿Bloqueó la sesión? | Acción tomada |
|---|---------|--------------|-------------|---------------|:-------------------:|---------------|
| 1 | | | | | ☐ Sí ☐ No | |

---

## 2. Hallazgos consolidados

Un hallazgo por fila. Consolidar a partir de las `HOJA-DE-REGISTRO.md` de cada participante
(no inventar: cada hallazgo debe apuntar a evidencia observada).

**Tipo de problema** (clasificación obligatoria — separar la causa):
- `USABILIDAD` — la experiencia confunde, aunque el motor y la captura sean correctos.
- `MOTOR` — el diagnóstico/estrategia/decisión produce algo incorrecto o poco explicable.
- `CAPTURA` — el cuestionario/normalización/estados de respuesta fallan o confunden.
- `PARTICIPANTE` — error del participante, no defecto del sistema (se registra, no se «corrige» en código).

**Severidad:** `CRÍTICA` (impide gobernar o auditar) · `ALTA` · `MEDIA` · `BAJA`.
**Impacto:** ¿afecta **gobernabilidad**, **auditabilidad**, ambas o ninguna?
**Decisión:** `CORREGIR AHORA` (solo si fue bloqueo crítico en sesión) · `CORREGIR DESPUÉS` · `NO CORREGIR`.

**ID estable (`H-###`).** Cada hallazgo lleva un identificador que **no cambia** (H-001,
H-002, …). Permite seguirlo luego: «H-004 corregido en Sprint 1», «H-009 descartado», «H-012
pendiente de validación», «H-015 resultó ser error del participante». Recuerda: por la **regla
de saturación**, la frecuencia y la decisión se completan **al cerrar la ronda**, no antes.

| ID | Hallazgo observado | Evidencia (cita/tarea/participante) | Severidad | Tipo | Frecuencia (n/5) | Impacto (gob/aud) | Corrección propuesta | Decisión |
|------|--------------------|-------------------------------------|-----------|------|:----------------:|-------------------|----------------------|----------|
| _ej._ | «No supo volver a la respuesta original desde el candidato» | P2 y P4, tarea 11; ambos abandonaron el nivel 4 | ALTA | USABILIDAD | 2/5 | Auditabilidad | Hacer visible el paso «Respuesta original» sin expandir tanto | CORREGIR DESPUÉS |
| H-001 | | | | | | | | |

---

## 3. Lectura de las métricas (observadas, no presumidas)

### Gobernabilidad — ¿cuántos participantes pudieron…?
- iniciar y completar el recorrido: ___/5
- comprender el estado de la evaluación: ___/5
- distinguir evidencia / faltantes / propuesta: ___/5
- decidir conscientemente: ___/5
- entender que **aceptar no ejecuta** acciones: ___/5

### Auditabilidad — ¿cuántos pudieron…?
- explicar por qué apareció el candidato: ___/5
- navegar hasta una respuesta original: ___/5
- identificar una limitación/faltante: ___/5
- reconstruir con sus palabras la razón de la decisión: ___/5

### Señales de fracaso observadas (frecuencia n/5)
- Aceptó sin leer (creyó paso obligatorio): ___
- Creyó que la confianza es probabilidad garantizada: ___
- No distinguió respuesta original de conclusión: ___
- Creyó que aceptar inició una acción real: ___
- No encontró cómo volver a la evidencia: ___
- No distinguió faltante / contradicción / no normalizable: ___
- El facilitador tuvo que explicar la pantalla: ___

---

## 4. Síntesis y próxima decisión

> **Criterio para decidir el siguiente paso (no automático).** La pregunta no es «¿ya toca
> Preparación?», sino: **¿los problemas observados afectan la comprensión/confianza del
> Director, o son solo detalles de refinamiento?**
> - Afectan la **comprensión o la confianza** → corregir **antes** de avanzar.
> - Son ajustes menores y **gobernabilidad + auditabilidad ya funcionan** → tiene sentido
>   iniciar Preparación.
> No convertir automáticamente cada dificultad observada en un cambio de producto: primero
> separar la causa (experiencia / captura / motor / técnico / participante).

- **Veredicto provisional — Gobernabilidad:** ☐ Lograda ☐ Parcial ☐ No lograda
- **Veredicto provisional — Auditabilidad:** ☐ Lograda ☐ Parcial ☐ No lograda
- **Tres hallazgos de mayor impacto:** 1) ______ 2) ______ 3) ______
- **Recomendación de próximo paso** (elegir con base en lo observado, no antes):
  ☐ corregir la experiencia · ☐ corregir los motores · ☐ ajustar la captura · ☐ avanzar a Preparación
- **Justificación:** ______________________________________________________________
