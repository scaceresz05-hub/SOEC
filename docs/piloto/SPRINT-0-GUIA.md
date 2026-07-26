# Sprint 0 — Guía de observación con usuarios (F2-PILOT-00)

> Objetivo del Sprint 0: **observar** si una persona externa puede *gobernar* un departamento
> usando solo la Evaluación + el Director Workspace, y si puede *reconstruir* por qué decidió.
> No es una demo comercial ni una encuesta de satisfacción. **La gobernabilidad y la
> auditabilidad se observan, no se presumen.** El facilitador NO explica la pantalla.

---

## 0. Reglas metodológicas (leer antes de facilitar)

**Regla 1 — No explicar la interfaz durante la prueba.** El observador solo interviene si el
participante queda **completamente bloqueado**. Prohibido usar frases como «ese botón hace…»,
«lo que pasa es que el sistema…», «aquí tienes que…». Si el usuario necesita esa explicación
para avanzar, **eso ya es un hallazgo de usabilidad** — anótalo, no lo resuelvas hablando.

**Regla 2 — Registrar el comportamiento, no solo la opinión.** «¿Te gustó?» aporta poco.
Registra **hechos observables** (ver «Comportamiento observado» en la hoja de registro):
cuánto tardó en encontrar el siguiente paso, qué botón buscó primero, qué información ignoró,
si leyó Transparencia, si recorrió la trazabilidad por iniciativa propia, si aceptó sin revisar
la evidencia, si creyó que «Aceptar» ejecutaba acciones reales. Ese tipo de observación revela
problemas que el participante no menciona.

**Regla 3 — Saturación de hallazgos.** NO corregir un problema después del primer usuario.
Registrar **todos** los hallazgos durante la ronda y **clasificarlos recién al finalizar**,
por frecuencia (n/5) y severidad. Un hallazgo en 4/5 y severidad alta → corregir antes de
Preparación; uno en 1/5 y severidad baja → no corregir todavía, seguir observando. Esto evita
el error clásico de modificar la interfaz entre participantes y terminar evaluando cinco
versiones distintas del sistema.

**Regla 4 — Congelación del producto.** Durante **toda la ronda**, la versión del producto
permanece **congelada**. Únicas excepciones para tocar código en medio de la ronda: caída del
sistema · pérdida de datos · corrupción de la evaluación · imposibilidad de continuar la
sesión. **Todo lo demás entra al backlog** (se registra como hallazgo, se decide después).

---

## 1. Puesta en marcha (sin intervención técnica durante la sesión)

Requisitos: Docker, Node ≥ 24. Desde la raíz del repo:

```bash
node scripts/start-local.mjs         # Postgres (5544) + API (3081) + Web (3080)
```

Espera a ver «Abra SOEC en el navegador: http://localhost:3080». Deja esa terminal abierta.

Prepara (o repone) los tres escenarios de demostración:

```bash
DATABASE_URL=postgres://soec:soec@localhost:5544/soec \
  npx tsx apps/api/scripts/seed-piloto.ts
```

El script imprime, para cada caso, dos URLs listas para usar (Evaluación y Workspace).

## 2. Reponer un escenario entre participantes (reset seguro)

Vuelve a ejecutar `seed-piloto.ts`. Es **no destructivo**: **archiva** las evaluaciones
anteriores (append-only, sin borrar eventos ni perder procedencia) y crea unas nuevas con
URLs nuevas. Así el participante 2 nunca ve las respuestas ni decisiones del participante 1.
Nunca hace falta borrar la base ni «limpiar» a mano.

## 3. Los tres escenarios

| Caso | Organización | Qué exhibe |
|------|--------------|-----------|
| **A** | Clínica Brille | Evidencia suficiente: señales claras → al menos un candidato con confianza razonable. |
| **B** | Clínica Nova | Evidencia incompleta: faltantes, incertidumbre y cobertura parcial o abstención. |
| **C** | Clínica Aurora | Información ambigua/corregida: una respuesta **no normalizable**, una corrección y **dos generaciones** (la anterior se preserva). |

Cada participante puede también **iniciar una evaluación nueva** desde la pantalla (no solo
usar las sembradas): así se observa el recorrido completo desde cero.

## 4. Checklist previo al piloto (automático + manual)

**Paso obligatorio — Pre-flight automático (Nivel 1).** No dependas de recordar un checklist:
ejecuta la batería de ~30 verificaciones técnicas. Si algo crítico falla, **NO comienza el
Sprint 0**.

```bash
DATABASE_URL=postgres://soec:soec@localhost:5544/soec pnpm sprint0:preflight
# (alias equivalente: pnpm piloto:check)
```

- Verifica: API/WEB/PostgreSQL, migraciones, seed, casos A/B/C en su estado esperado,
  trazabilidad y transparencia abren, y el flujo completo (iniciar→responder→normalización→
  generar→aceptar→persistencia→revocar) sobre un **sandbox efímero** que no toca A/B/C.
- Escribe el informe en `docs/piloto/PRE-FLIGHT-REPORT.md` y declara **APTO / NO APTO**
  (sale con código ≠ 0 si no es apto).

**Manual (lo que el pre-flight no cubre):**
- [ ] Pre-flight = **APTO PARA SPRINT 0** (revisar `PRE-FLIGHT-REPORT.md`).
- [ ] Abrir `http://localhost:3080/evaluacion` en el navegador real y confirmar **consola sin
      errores** (el pre-flight marca este ítem como ⚠: requiere navegador, no es automatizable).
- [ ] Hoja de registro impresa/abierta por participante (`HOJA-DE-REGISTRO.md`).
- [ ] El facilitador tiene claro que **no debe explicar la pantalla** ni sugerir acciones (§0).
- [ ] Producto **congelado** durante toda la ronda (regla 4 del §0).

---

## 5. Guion de observación (tareas para el participante)

Se leen **sin** explicar cómo resolverlas. Da la URL de un caso (o pídele iniciar una nueva).

1. Selecciona una organización.
2. Inicia una evaluación nueva.
3. Responde lo que puedas.
4. Guarda y abandona la pantalla (navega a otra sección o cierra la pestaña).
5. Reanuda la evaluación.
6. Corrige una respuesta.
7. Genera la comprensión.
8. Identifica qué entendió SOEC.
9. Identifica qué información falta.
10. Revisa por qué propone un objetivo.
11. Recorre la evidencia hasta una respuesta original.
12. Acepta, rechaza o cierra sin decidir.
13. Explica con tus palabras qué ocurrió.

## 6. Preguntas posteriores (pocas y abiertas)

- ¿Qué crees que hizo el sistema?
- ¿Qué información usó?
- ¿Qué parte te generó más dudas?
- ¿Confiarías en esta recomendación?
- ¿Qué necesitarías ver antes de aceptarla?
- ¿Qué esperabas que ocurriera al aceptar?
- ¿Podrías explicarle a otra persona por qué tomaste esa decisión?

---

## 7. Métricas del piloto (se observan, no se presumen)

### Gobernabilidad — se considera lograda *provisionalmente* si el participante puede:
- iniciar y completar el recorrido;
- comprender el estado de la evaluación;
- distinguir evidencia, faltantes y propuesta;
- decidir conscientemente;
- entender que la decisión **no ejecuta** todavía acciones operativas.

### Auditabilidad — se considera lograda *provisionalmente* si puede:
- explicar por qué apareció el candidato;
- navegar desde el candidato hasta una respuesta original;
- identificar al menos una limitación o información faltante;
- reconstruir, con sus palabras, la razón de la decisión.

### Señales de fracaso (anótalas apenas ocurran)
- Acepta sin leer, porque cree que es el siguiente paso obligatorio.
- Cree que la confianza es una probabilidad matemática garantizada.
- No distingue una respuesta original de una conclusión.
- Cree que aceptar inició una campaña o acción real.
- No encuentra cómo volver a la evidencia.
- No comprende la diferencia entre **faltante**, **contradicción** y **no normalizable**.
- El facilitador tiene que explicar constantemente la pantalla.

---

## 8. Después del piloto

Consolidar hallazgos por participante y por tarea. Los hallazgos deciden el siguiente paso
(corrección de experiencia o de motores), **antes** de considerar Preparación. La proyección
de escala del read-model se revisa solo si el volumen de eventos hiciera inviable la prueba
(hoy no ocurre).
