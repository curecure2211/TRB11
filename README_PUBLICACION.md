# TRB web pública v12

Versión completa para ejecutar localmente o desplegar en internet.

## Inicio local

```bash
python serve_trb.py --host 127.0.0.1 --port 8080 --auto-prefetch --open
```

## Inicio en hosting

```bash
python serve_trb.py --host 0.0.0.0 --port "$PORT" --auto-prefetch
```

Archivos de despliegue incluidos:

- `render.yaml`
- `Dockerfile`
- `Procfile`
- `PUBLICAR_EN_INTERNET.md`

La aplicación incluye 23 empresas, 93 rutas, búsqueda de direcciones, ubicación, cálculo de caminatas, trazado del bus y una interfaz adaptable a móviles.
