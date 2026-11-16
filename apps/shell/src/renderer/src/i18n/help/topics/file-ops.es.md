# Operaciones de archivo: cambiar nombre, eliminar, exportar

Este capítulo cubre las operaciones de archivo comunes a todos los editores; las opciones de exportación propias de cada editor están en su capítulo.

El **menú ⋯** de la fila (pase el cursor por una fila de archivo) reúne estas acciones:

![El menú ⋯ de una fila de archivo](img/file-ops.png)

## Cambiar nombre

Dos puntos de entrada, un mismo conjunto de comprobaciones:

- **⋯ ▸ Cambiar nombre** en una fila de la pantalla de inicio.
- **Haga doble clic en una pestaña de archivo** para cambiar el nombre en el sitio (véase [Pestañas y gestión de ventanas](help://tabs-and-windows)).

Reglas: la extensión se conserva automáticamente; los caracteres no permitidos, los puntos finales y los nombres reservados (CON/NUL y similares) se rechazan con un mensaje; también se bloquea un conflicto de nombres en la misma carpeta. El archivo real del disco se renombra, y la lista de recientes y los destacados se actualizan.

## Eliminar

- **⋯ ▸ Eliminar** en Inicio: pregunta qué archivos y luego los mueve a la **papelera del sistema**, desde donde el sistema operativo puede restaurarlos. GenOffice no guarda ningún deshacer propio para esto — la recuperación es cosa de la papelera, no de una notificación.

## Duplicar

**⋯ ▸ Duplicar** crea una copia llamada <name> copy en la misma carpeta; si el nombre ya existe, se añade un contador automáticamente. La copia se añade a **Recientes** en lugar de abrirse: queda a un clic, no delante de ti.

## Guardar y Guardar como

- **⌘S / ctrl+S** guarda el archivo actual; si no tiene título, primero pregunta por la ubicación y el nombre.
- En la mayoría de los editores, la lista de tipos de archivo del cuadro Guardar como también ofrece los formatos de exportación (PDF, imágenes, otros formatos de documento). Al elegir uno de ellos solo se escribe una copia; el documento abierto y su pestaña siguen con el archivo original. Las imágenes de varias páginas se reparten en `nombre-01.png`, `nombre-02.png`, ….
- **Docs**: la lista Guardar como también ofrece .hwp y .hwpx (Archivo ▸ Exportar como documento HWP… hace lo mismo). Si algo no se puede trasladar, como comentarios, ecuaciones o cuadros de texto, se le avisa antes de escribir el archivo.
- **Guardar como** escribe un archivo nuevo y deja el original intacto; las ediciones posteriores se dirigen al archivo nuevo.
- Cada guardado es atómico (archivo temporal y renombrado): salir a mitad de la escritura no puede corromper el archivo.
- El autoguardado sigue el interruptor de cada editor; un documento nuevo sin archivo propio empieza tras su primer guardado (véase [Inicio rápido](help://getting-started)).

## Exportar a PDF

- **Docs**: Archivo ▸ Exportar como PDF (o el botón de la cinta de opciones), paginado según el diseño actual.
- **Slides**: la exportación rasteriza página a página, con progreso para presentaciones grandes.
- **Sheets**: la exportación sigue la paginación de impresión.
- Las exportaciones se renderizan en una ventana oculta y terminan donde usted elija.

## Exportar a Word / imágenes

- **PDF ▸ PDF a Word**: convierte el PDF en .docx (conversión local; los diseños complejos se conservan en la medida de lo posible).
- **Docs** puede exportar las páginas como imágenes (un PNG por página).

## Imprimir

Archivo ▸ Imprimir (⌘P/ctrl+P) abre una ventana de impresión en cada editor. Docs, PDF, Sheets, Slides y Markdown tienen la sección **Disposición de páginas** en su ventana de impresión de siempre, HWP en la vista previa de impresión, y HTML, mapa mental y diagrama en una nueva ventana de impresión pequeña. Si no elige nada en Disposición de páginas, se imprime igual que antes.

- **Disposición**: elija Una página por hoja, Varias páginas por hoja (2, 4, 6, 9 o 16), Folleto (encuadernar a la izquierda o a la derecha), Póster (hojas a lo ancho y a lo alto, solapamiento, líneas de corte) o Etiquetas (una página por etiqueta o la misma página en cada etiqueta, etiqueta inicial, un formato A4 habitual o medidas personalizadas).
- **Solo caras impares, solo caras pares, orden inverso**: las caras se cuentan después de aplicar la disposición, sobre lo que realmente sale de la impresora. Sirve en impresoras sin doble cara: imprima los anversos, dé la vuelta al papel e imprima los reversos.
- **Reducir para ajustar al papel**: solo se reducen las páginas más grandes que el papel elegido; las más pequeñas no se amplían. Sheets y Markdown usan sus propios ajustes de papel y escala.
- **Escala de grises y resolución de imagen**: al imprimir con opciones de Disposición de páginas, cada página se convierte en imagen antes de enviarse a la impresora. La resolución se elige entre Automática, 150, 300 o 600 dpi.
- **Solo la selección**: Docs y Markdown imprimen solo el texto seleccionado, repaginado desde la primera página; Slides imprime las diapositivas seleccionadas y PDF las páginas seleccionadas. Sheets imprime el rango seleccionado como antes.
- **Esquema de disposición y vista previa del resultado**: el esquema muestra al instante dónde cae cada número de página en el papel, y **Vista previa del resultado** muestra lo que se ha generado de verdad. Con **Guardar el resultado dispuesto como PDF** puede imprimir la misma disposición en otro PC o en una imprenta.
- **Ventana de impresión del sistema**: para un folleto, elija doble cara volteando por el borde corto. Deje el intervalo de páginas y las páginas por hoja tal como están en la ventana del sistema.

Los PDF se imprimen con el orden de páginas y las rotaciones actuales.

## Dónde viven los archivos sin título

La ubicación que elija en el primer guardado es su hogar. Hasta entonces el documento no tiene archivo propio: su contenido sin guardar solo se conserva como copia de recuperación en la carpeta de datos de la aplicación, de modo que puede volver si la aplicación se apaga de repente (vea [Pestañas y gestión de ventanas](help://tabs-and-windows)). El autoguardado toma el relevo solo después de ese primer guardado.
