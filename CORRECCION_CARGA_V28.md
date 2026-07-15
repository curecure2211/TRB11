# Corrección de carga TRB v28

Se corrigió el error `Cannot set properties of null (setting innerHTML)` que impedía abrir la aplicación.

La portada v27 ya no contenía los elementos `factsGrid` y `featuredRoutes`, pero `app.js` todavía intentaba renderizarlos durante el inicio. Ahora ambas funciones verifican que el contenedor exista antes de escribir contenido. También se incrementó la versión de caché a v28 para evitar que el navegador reutilice el JavaScript defectuoso.
