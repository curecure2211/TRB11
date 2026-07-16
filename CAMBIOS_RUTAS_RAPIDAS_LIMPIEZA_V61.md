# TRB v61 - rutas más rápidas y limpieza

Cambios:

- Se redujo la cantidad de puntos internos usados para calcular parada flexible de buses urbanos.
- El cálculo ya no recorre combinaciones pesadas ampliadas en cada búsqueda normal.
- El motor usa la caché del servidor `/api/route-geometry` cuando está disponible en Render.
- Los resultados dejan de esperar rutas extra innecesarias antes de aparecer.
- Se mantiene la regla: buses urbanos pueden subir/bajar en el punto cercano del recorrido; Transmetro conserva estaciones/paraderos.
- Se preparó una lista de archivos basura que se pueden borrar del repositorio.
