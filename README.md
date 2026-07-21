# SOEC

Raíz oficial del proyecto: `C:\proyectos\SOEC`. Toda la documentación, código, scripts, herramientas, pruebas, arquitectura y artefactos viven dentro de esta ruta. No se crean repositorios paralelos ni estructuras alternativas fuera de aquí, salvo autorización explícita del Propietario del Producto.

## Estado actual: FASE 0 — FUNDACIÓN

**Regla dura:** ningún componente funcional del producto se implementa antes de completar satisfactoriamente la Fase 0. Durante esta fase no se desarrolla el producto — se construye la **ingeniería del proyecto**: la única fuente de verdad que permitirá desarrollar con rapidez, coherencia y continuidad durante años.

Ver el estado vivo en [MASTER_STATUS.md](MASTER_STATUS.md) y el contexto en [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md).

## Estructura

```text
C:\proyectos\SOEC
├── docs\                 Biblioteca Maestra (fuente de verdad)
│   ├── constitution\     Principios rectores, misión, reglas invariantes
│   ├── architecture\     Arquitectura oficial (backend, frontend, servicios, IA, datos, eventos, infra)
│   ├── roadmap\          Roadmap oficial — todas las fases
│   ├── adr\              Architecture Decision Records
│   ├── standards\        Naming, testing, logging, observabilidad, seguridad
│   ├── ai\               Estrategia y contratos de IA
│   ├── domain\           Modelo del Dominio: MED, MDM, entidades, relaciones, contratos
│   └── decisions\        Bitácora de decisiones no-arquitectónicas
│
├── backend\              (Fase 1+) código de backend
├── frontend\             (Fase 1+) código de frontend
├── infrastructure\       Infraestructura y despliegue
├── tests\                Pruebas
├── scripts\              Scripts operativos
├── tools\                Herramientas de apoyo
├── resources\            Recursos varios
├── experiments\          Prototipos aislados — no se incorporan al núcleo sin validación formal
├── temp\                 Archivos temporales
│
├── .claude\              Sistema de contexto permanente para Claude
│   ├── context\          Contexto persistente del proyecto
│   ├── prompts\          Prompts oficiales
│   ├── memory\           Memoria permanente
│   └── rules\            Reglas de trabajo de Claude
│
├── .github\              Configuración de repositorio / CI
│
├── README.md
├── MASTER_STATUS.md      Estado vivo de la Fase 0 y el proyecto
├── PROJECT_CONTEXT.md    Contexto maestro — qué es SOEC, para quién, por qué
└── CHANGELOG.md          Historial de cambios
```

## Regla permanente

Toda modificación toma como referencia `C:\proyectos\SOEC`. Si se detecta una estructura distinta, se informa la discrepancia antes de continuar. Esta ruta es la ubicación oficial durante la Fase 0 y mientras no exista una instrucción formal que la modifique.
