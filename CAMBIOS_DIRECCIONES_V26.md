# TRB v26 — direcciones precisas y limpieza de rutas

- Normaliza direcciones colombianas: Carrera/Cra/Kr, Calle/Cl y No./# .
- Corrige errores frecuentes como `carreara`.
- Prueba el número exacto y, si no existe en la fuente, una intersección cercana claramente marcada como aproximada.
- Añade `/api/geocode` combinando Google Geocoding, Google Places, Photon y Nominatim.
- Incluye `CONFIGURAR_BUSCADOR_GOOGLE.bat` para pegar la clave una sola vez.
- Al volver de Instrucciones a Sugerencias se elimina la ruta seleccionada, sus buses y su ficha del mapa.
