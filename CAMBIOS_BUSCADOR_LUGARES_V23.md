# TRB v23 — Buscador inteligente de lugares

- Autocompletado en línea mientras se escribe.
- Resultados de universidades, escuelas, hospitales, clínicas, centros comerciales, barrios, parques y otros lugares.
- Universidad del Atlántico incluida como coincidencia local inmediata con alias como Uniatlántico y Ciudadela Universitaria.
- Búsqueda con tolerancia a errores mediante Photon/OpenStreetMap.
- Proxy y caché en `serve_trb.py` para desacoplar el navegador del proveedor.
- Nominatim se conserva únicamente como búsqueda final de respaldo, no como autocompletado.
- Variable `TRB_PHOTON_URL` para cambiar a una instancia propia o proveedor compatible.
