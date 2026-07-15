# TRB v25

- Sugerencias ordenadas estrictamente de menor a mayor tiempo.
- Hasta 18 resultados de lugares por búsqueda.
- Universidad del Atlántico: sede Norte, sede Centro, Bellas Artes y dependencias principales.
- Photon/OpenStreetMap como proveedor abierto.
- Google Places Text Search opcional mediante `TRB_GOOGLE_PLACES_API_KEY`. La clave queda en el servidor.
- Página `driver.html` para transmitir GPS del conductor.
- API `POST /api/vehicles/location` y lectura `GET /api/vehicles`.
- En producción configura `TRB_DRIVER_TOKEN` y publica siempre mediante HTTPS.
