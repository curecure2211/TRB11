# Cambios de TRB web pública v12

- Servidor compatible con la variable `PORT` de hostings públicos.
- Escucha automática en `0.0.0.0` cuando se ejecuta en hosting.
- Endpoint de salud `/healthz`.
- Blueprint `render.yaml`, Dockerfile y Procfile.
- Tres proveedores alternativos para cargar Leaflet.
- Proveedor alternativo de mosaicos cuando el mapa base principal falla.
- Mensaje visible y botón de reintento en lugar de un mapa vacío.
- Recalculo del tamaño del mapa al abrir la pestaña, cambiar el tamaño o girar el teléfono.
- URLs de API relativas para funcionar correctamente con el dominio público.
- Respaldo para geometrías JSON generadas previamente.
- Caché PWA actualizada a v12.
