# Configurar búsqueda amplia y GPS en TRB v25

## Búsqueda de lugares

TRB funciona de inmediato con Photon/OpenStreetMap y una lista local de lugares importantes.
Para resultados más cercanos a Google Maps, configura en el servidor:

```bash
TRB_GOOGLE_PLACES_API_KEY=tu_clave
```

La clave permanece en el backend y no se expone en el navegador. Activa Places API (New) y facturación en Google Cloud antes de usarla.

## GPS real de conductores

Configura un token secreto:

```bash
TRB_DRIVER_TOKEN=un_token_largo_y_secreto
```

Publica TRB con HTTPS. El conductor abre:

```text
https://tu-dominio/driver.html
```

Ingresa el identificador del bus, el código de ruta y el token. La página envía GPS al endpoint:

```text
POST /api/vehicles/location
```

La página de pasajeros consulta:

```text
GET /api/vehicles
```

Cada posición activa aparece en el mapa con la etiqueta EN VIVO.

## Arquitectura recomendada para producción

Conductor / dispositivo GPS → API TRB → base de datos de posiciones → página TRB.

Para una operación pequeña no necesitas construir una plataforma tan grande como Fintraffic. Cuando crezca el sistema, conviene publicar las posiciones también como GTFS-Realtime VehiclePositions para que otras aplicaciones puedan consumirlas.
