# TRB v59 · móvil estilo HSL y ajustes únicos

Cambios para subir a GitHub:

- Se corrigió el color del texto "Movilidad Barranquilla" en móvil.
- Se retiró el botón "Mi ubicación" del formulario y se movió como control flotante dentro del mapa.
- Las pestañas "Todas, Buses, Transmetro, Rutas combinadas y Bici" quedan ocultas.
- Las combinaciones ahora dependen solo de Ajustes:
  - Bus activo = muestra buses.
  - Transmetro activo = muestra Transmetro y alimentadores.
  - Bus + Transmetro activos = mezcla ambas redes.
  - Especiales activo = agrega transbordos oficiales.
- El buscador móvil ya no muestra el mapa antes de elegir ruta.
- Después de seleccionar una ruta, el mapa aparece arriba y las sugerencias/instrucciones quedan como panel inferior tipo HSL.
- Se cambió la iconografía de origen/destino por puntos tipo HSL.
- Se cambió el icono de buses visibles y buses simulados por un bus tipo HSL.
- Se quitó el conteo "X de Y rutas" durante la carga.
- Se reducen renders de estado durante la búsqueda para hacerla más ágil.
