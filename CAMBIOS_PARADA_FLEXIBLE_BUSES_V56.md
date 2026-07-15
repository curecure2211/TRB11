# TRB v56 — Parada flexible para buses urbanos

Cambios aplicados para publicar en Render/GitHub:

- En rutas SIBUS/buses urbanos, el punto de abordaje y descenso se calcula sobre el recorrido oficial, no como paradero fijo.
- Transmetro conserva su lógica de estaciones/paraderos; la parada flexible no se aplica a Transmetro.
- Si un bus directo pasa a una caminata razonable de 4–10 minutos, se prioriza antes que combinaciones con otro bus.
- Se aumentó la precisión de muestreo de rutas SIBUS para detectar mejor puntos cercanos sobre el trayecto.
- En las instrucciones se muestra “Bus urbano · parada flexible”.
- Caché PWA actualizada a v56.
