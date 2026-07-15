# Corrección del problema de carga KMZ

## Causa

La página se estaba abriendo mediante `file://`. En ese modo el navegador bloquea las peticiones necesarias para leer los archivos KMZ y sus respuestas remotas por las reglas de origen y CORS.

## Cambios realizados

- lanzador de Windows `INICIAR_TRB.bat`;
- lanzador rápido de Windows `INICIAR_TRB_RAPIDO.bat`;
- lanzador de macOS `INICIAR_TRB.command`;
- script Linux `iniciar_trb.sh`;
- opción `--prepare --open` en `serve_trb.py`;
- descarga paralela y reintentos;
- corrección de URLs que contienen espacios;
- endpoint `/api/health` y estado de caché KMZ;
- el motor evita llamadas remotas duplicadas cuando está activo el servidor local;
- aviso inmediato cuando la aplicación fue abierta como archivo;
- actualización de la caché PWA para impedir que siga ejecutándose el JavaScript anterior;
- `TRB-Web-Demo.html` convertido en una pantalla de apertura segura.

## Primera ejecución

Ejecutar `INICIAR_TRB.bat`. El proceso prepara las rutas y abre `http://127.0.0.1:8080`.
