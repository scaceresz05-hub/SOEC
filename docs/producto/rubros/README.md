# Biblioteca de Conocimiento por Rubro — patrón oficial

> Cómo SOEC modela un rubro. Cada rubro es una **biblioteca versionada y auditable de conocimiento**, no un archivo de configuración. Este documento define el **patrón** que siguen todos los rubros; `clinica-dental.md` es su primera instancia oficial. Subordinado al Modelo Operativo (`../MODELO-OPERATIVO-SOEC.md`) y a la directiva `../../decisions/f2-disc-01-directiva-diagnostico-y-estrategia.md`.

## Rubro ≠ Instancia

El conocimiento del **rubro** (tipo de negocio) es curado, compartido y versionado. La **instancia** (una empresa concreta) es privada. El conocimiento de rubro **nunca** se contamina con datos de una instancia; una instancia solo **valida**.

## Estados de madurez del conocimiento

Todo elemento y toda capa declaran su estado. Transiciones:

```
DRAFT  →  PRELIMINARY  →  RATIFIED  →  DEPRECATED
```

- **DRAFT** — borrador de trabajo; SOEC no lo usa.
- **PRELIMINARY** — utilizable con cautela: SOEC puede **leerlo y advertir**, pero **nunca tratarlo como verdad certificada** (p. ej., conocimiento regulatorio pendiente de validación jurídica).
- **RATIFIED** — aprobado por el Director; es la referencia oficial.
- **DEPRECATED** — reemplazado; se conserva por trazabilidad, no se usa.

## Confianza (para SOEC, no para el usuario)

Cada elemento declara `confidence: HIGH | MEDIUM | LOW`. No todo el conocimiento tiene la misma solidez; el motor lo usa para ponderar hipótesis y ordenar propuestas.

## Esquema de auditoría por elemento

Cada entrada lleva un **identificador permanente** (la identidad no cambia; si el contenido cambia, cambia su versión) y metadatos:

| Campo | Significado |
|---|---|
| `id` | Identificador permanente (p. ej. `OBJ-CD-01`). Estable de por vida. |
| `origen` | Quién lo incorporó. |
| `incorporado` | Cuándo (fecha absoluta). |
| `motivo` | Por qué. |
| `aparece_en` | Versión en la que apareció. |
| `cambio` | Qué cambió respecto de la versión anterior. |
| `estado` | Estado de madurez (arriba). |
| `confidence` | HIGH / MEDIUM / LOW. |
| `verification_status` | Solo capa regulatoria: `PENDING_LEGAL_REVIEW` / `VERIFIED`. |

## Tipos de conocimiento

Un rubro contiene entradas de estos tipos, agrupadas en tres capas:

- **Capa Universal:** `objetivo`, `estrategia`, `metrica`, `embudo`, `restriccion_general`, **`supuesto`** *(hipótesis general del rubro — no es objetivo, ni estrategia, ni regulación; puede cambiar)*.
- **Capa Regulatoria:** `regulatorio` *(prohibiciones y límites legales/sanitarios; por defecto `PRELIMINARY / PENDING_LEGAL_REVIEW` hasta validación jurídica por jurisdicción)*.
- **Capa de Producto:** `producto` *(cómo SOEC interpreta el rubro)*; **`senal`** *(señal diagnóstica con `condicionActivacion` explícita sobre una pregunta cerrada)* y **`mapeo`** *(regla causal versionada señal→objetivo→estrategia)* — v1.1. Además, cada `estrategia` declara **activadores regulatorios tipados** (`ActivadorRegulatorio`) y cada `regulatorio` los que `observa` con su `efecto` (`ADVIERTE`/`BLOQUEA`), para aplicabilidad por candidato.

## Gobernanza

El conocimiento de rubro es un **activo gobernado** (Gate G1 de la directiva F2-DISC-01). Fijar o cambiar la versión oficial de un rubro exige **justificación + análisis de impacto + aprobación explícita del Director**, y queda registrada en el propio activo y en el CHANGELOG.
