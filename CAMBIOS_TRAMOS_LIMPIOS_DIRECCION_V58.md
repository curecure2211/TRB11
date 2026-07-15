# TRB v58 - Tramos limpios y dirección de buses urbanos

Cambios principales:

- Al abrir una línea desde una alternativa combinada, TRB limpia la capa anterior antes de dibujar la nueva.
- Si vuelves atrás y abres el otro bus de la conexión, solo se ve esa ruta seleccionada.
- El bus de demostración ahora corre solo sobre el tramo usado de la alternativa, no sobre toda la ruta completa.
- Se agregó protección contra cargas tardías: una ruta que terminaba de cargar tarde ya no queda dibujada detrás de otra.
- Para buses urbanos, el motor también evalúa el trazado inverso cuando el KMZ viene con el orden incorrecto o poco confiable, con penalización si la dirección original parecía conocida.
- Se aumentó el análisis de puntos flexibles para escoger mejor la misma calle/calzada al subir y al bajarse.

Notas:

- Esta corrección aplica a buses urbanos/SIBUS.
- Transmetro conserva estaciones/paraderos y recorridos propios.
