# TRB v20 — Flujo HSL de sugerencias e instrucciones

- Al buscar un viaje, la navegación lateral general desaparece en escritorio.
- El mapa ocupa toda la pantalla junto al panel de Sugerencias de ruta.
- Al seleccionar una alternativa, el panel cambia a Instrucciones.
- Las instrucciones muestran salida, caminatas, bicicleta, abordajes, transbordos, descensos y llegada.
- El botón de regreso vuelve desde Instrucciones a Sugerencias de ruta.
- El botón superior de regreso restaura la interfaz general de TRB.

## Precisión cartográfica

- Los trazados KMZ oficiales se conservan sin unir fragmentos separados por grandes saltos.
- La tolerancia de unión bajó de 500 m a 60 m para evitar líneas que atraviesen manzanas o viviendas.
- Caminatas y bicicleta se calculan sobre la red vial mediante `/api/network-route`.
- Las rutas de Transmetro sin geometría oficial se ajustan a calles usando sus paraderos como puntos de paso.
- Los transbordos se limitan a 320 m en línea recta y luego se recalculan sobre la red peatonal.
- Si el servicio vial no responde, TRB no dibuja una línea recta sobre edificios.
