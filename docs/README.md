# Documentación

## Estructura

```text
docs/
├── versiones/
│   └── v1/
│       ├── PRD.md
│       └── TAREAS_DESARROLLO.md
└── funcionalidades/
    └── <slug-de-funcionalidad>/
        ├── PRD.md
        └── TAREAS_DESARROLLO.md
```

## Convención

- `versiones/v1` contiene el alcance inicial completo de Travellier.
- Cada funcionalidad futura se documenta en `funcionalidades/<slug-de-funcionalidad>`.
- Cada carpeta de funcionalidad debe incluir su propio `PRD.md` y `TAREAS_DESARROLLO.md`.
- El PRD de una funcionalidad no debe alterar el alcance de otra sin una actualización explícita de ambos documentos.
