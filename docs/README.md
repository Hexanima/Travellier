# Documentación

## Estructura

```text
docs/
├── versiones/
│   └── v1/
│       ├── PRD.md
│       ├── PRD-original.md
│       └── TAREAS_DESARROLLO.md
└── funcionalidades/
    └── <slug-de-funcionalidad>/
        ├── PRD.md
        └── TAREAS_DESARROLLO.md
```

## Convención

- `versiones/v1` contiene el alcance inicial completo de Travellier.
- [PRD.md](versiones/v1/PRD.md) es el único documento vigente, aprobado y fijado junto con el diseño azul el 2026-10-11. Los cambios de alcance, reglas o diseño requieren solicitud o aprobación explícita del usuario y se registran directamente en sus documentos. [PRD-original.md](versiones/v1/PRD-original.md) conserva el primer documento incorporado al repositorio (commit `c72ca71`, entonces `docs/PRD.md`), sin modificaciones.
- Mantener únicamente esos dos PRDs para v1. No crear otra revisión por cada conversación; las modificaciones autorizadas del documento vigente se comparan con el original y se versionan mediante Git.
- Actualizar el PRD no modifica automáticamente `TAREAS_DESARROLLO.md` ni acredita implementación. El usuario ajustará las tareas después de comparar revisiones.
- El [diseño navegable aprobado](../design/prototype/README.md) y su [evaluación contra el PRD](../design/prototype/PRD-AUDIT.md) se conservan en `design/prototype`, separados del código productivo. La evaluación identifica las diferencias pendientes sin dar por completadas las tareas.
- Cada funcionalidad futura se documenta en `funcionalidades/<slug-de-funcionalidad>`.
- Cada carpeta de funcionalidad debe incluir su propio `PRD.md` y `TAREAS_DESARROLLO.md`.
- El PRD de una funcionalidad no debe alterar el alcance de otra sin una actualización explícita de ambos documentos.
