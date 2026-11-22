# Pizarra: lluvia de ideas, bocetos y anotaciones

El editor de pizarra abre archivos `.whiteboard` en una pestaña. Permite organizar notas adhesivas, texto, formas, conectores, tablas, pegatinas, imágenes, tarjetas de enlace y trazos a mano alzada en tableros infinitos o páginas fijas, importar páginas PDF como fondo, exportar a imagen o PDF y trabajar con el panel de IA. Todo funciona de forma local en tu PC.

## Abrir y crear

- Una pizarra nueva comienza como un tablero libre infinito desde el mosaico **Pizarra** en Inicio o desde Nuevo en el menú Archivo.
- El editor abre archivos `.whiteboard` desde el diálogo de apertura, arrastrando a la ventana, desde archivos recientes, el árbol de carpetas, Vista rápida (Espacio) o Google Drive. En Windows, al instalar GenOffice se registra como programa predeterminado para `.whiteboard`.
- Los archivos Excalidraw (`.excalidraw`, `.excalidraw.png`, `.excalidraw.svg`) se importan como una pizarra nueva sin título. Nunca se sobrescribe el original, cerrar sin cambios no pide guardar y el primer guardado propone `.whiteboard` en la misma carpeta. Los elementos no compatibles como incrustaciones web se omiten mostrando su cantidad en un aviso. En Windows `.excalidraw` aparece solo en "Abrir con".
- Si la pizarra ya está abierta, su pestaña pasa al frente.

## Edición y herramientas

- Un mismo archivo `.whiteboard` puede combinar tableros libres y páginas fijas (pantalla 16:9, A4 vertical u horizontal y tamaños personalizados de páginas PDF) en la barra de páginas.
- Las herramientas incluyen selección, notas adhesivas, texto enriquecido, ocho formas, conectores y flechas, lápiz sensible a la presión, resaltador y borrador, imagen, tabla, pegatinas integradas y tarjetas de enlace.
- Arrastra un archivo `.pdf` sobre una pizarra abierta o elige **Importar PDF** para convertir las páginas seleccionadas en fondos fijos sobre los que anotar y dibujar. Abrir un `.pdf` desde Inicio o Archivo sigue abriéndolo en el editor de PDF.
- Pulsa F5 o haz clic en **Presentar** para ver la pizarra a pantalla completa y pasar páginas con las flechas.
- En el tema oscuro se oscurecen las barras de herramientas, paneles y el fondo exterior, mientras que el papel, las notas, formas y trazos mantienen los colores originales del documento.

## Guardar, exportar e imprimir

- Guardar, Guardar como, Autoguardado, copias de recuperación y avisos de conflicto en vista dividida funcionan igual que en los demás editores. Si no hubo cambios, no se vuelve a escribir el archivo.
- Exporta a PNG, SVG o PDF para **Todas las páginas** o **Solo la página actual**. En un tablero libre, la exportación y la impresión se ajustan a todos los objetos con margen o al área inicial si está vacío.
- Imprimir (Ctrl+P) admite impresión estándar y opciones avanzadas de diseño de página. Las exportaciones e impresiones son idénticas en tema claro y oscuro.

## Panel de IA

- Pide a la IA que organice notas adhesivas, diseñe una plantilla de taller o retrospectiva, agregue formas, conectores, tablas o imágenes, o resuma el tablero.
- La IA recibe una tabla de texto estructurada y, cuando el modelo seleccionado admite imágenes, adjunta automáticamente una captura de la página actual. Los modelos solo de texto usan únicamente la tabla.
- Cada llamada de edición de la IA es un solo paso de deshacer (Ctrl+Z), resalta en pantalla los objetos cambiados sin alterar el archivo guardado y ofrece **Deshacer estos cambios** en la tarjeta de respuesta.
- Los archivos `.whiteboard` se pueden adjuntar en los paneles de IA de otros editores, mencionar con `@`, buscar desde Inicio, usar en **Crear otro documento** (incluida la conversión a Markdown sin IA) y manejar desde los [comandos de terminal](help://cli) (`ieumoffice whiteboard read`, `ieumoffice whiteboard apply`, `ieumoffice create --type whiteboard`).

## Uso de internet y tarjetas de enlace

- Abrir, editar, exportar, imprimir e importar archivos Excalidraw o páginas PDF no envía nada a internet.
- Al hacer clic en una tarjeta de enlace se abren direcciones `http`, `https` o `mailto` en tu navegador predeterminado.
- Solo si activas expresamente **Obtener título e imagen de vista previa** al añadir o editar una tarjeta de enlace, GenOffice se conecta una vez a esa página y guarda la vista previa dentro del archivo `.whiteboard`.
