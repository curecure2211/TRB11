# Publicar TRB en internet

Esta versión está preparada para un hosting que ejecute Python. No la publiques únicamente como archivos estáticos, porque el servidor convierte los KMZ oficiales a geometría JSON y evita los bloqueos CORS.

## Opción recomendada: Render

1. Crea un repositorio nuevo en GitHub.
2. Sube **el contenido de la carpeta TRB**, no la carpeta exterior del ZIP.
3. En Render elige **New + → Blueprint**.
4. Conecta el repositorio.
5. Render detectará `render.yaml`.
6. Confirma el servicio y espera el despliegue.
7. Abre la dirección pública que Render genere.

El servidor usa automáticamente la variable `PORT`, escucha en `0.0.0.0` y expone `/healthz` para la comprobación de estado.

## Opción Docker

```bash
docker build -t trb-barranquilla .
docker run --rm -p 8080:8080 -e PORT=8080 trb-barranquilla
```

Después abre `http://localhost:8080`.

## Por qué antes el mapa podía quedar vacío

La versión anterior dependía de:

- Leaflet cargado desde un único CDN;
- un servidor Python abierto manualmente;
- llamadas a `/api/route-geometry` que no existen en un hosting puramente estático;
- el tamaño del mapa calculado mientras la pestaña estaba oculta.

La v12 corrige esos cuatro puntos:

- prueba tres proveedores de Leaflet;
- muestra un diagnóstico visible si ninguno responde;
- usa un backend apto para internet;
- recalcula el tamaño del mapa al abrirlo, redimensionar o girar el teléfono;
- cambia automáticamente a un proveedor alternativo de mosaicos si OpenStreetMap no responde.

## Comprobación rápida después de publicar

Abre estas direcciones sustituyendo el dominio:

```text
https://TU-DOMINIO/healthz
https://TU-DOMINIO/api/health
```

Ambas deben devolver JSON con `"ok": true`.

Luego entra en **Mapa**. Deben verse las calles de Barranquilla. Selecciona una ruta y espera la conversión del KMZ. La primera consulta puede tardar más porque el servidor descarga y guarda el archivo.

## Límites actuales

- Los buses visibles son simulados; no representan GPS real.
- La búsqueda de direcciones depende de servicios externos basados en OpenStreetMap.
- Los tiempos son aproximados y no incluyen tráfico ni espera real.
- En planes gratuitos, el disco del servidor puede reiniciarse; las geometrías se vuelven a generar cuando sea necesario.
