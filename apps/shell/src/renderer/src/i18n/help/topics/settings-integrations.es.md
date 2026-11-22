# Configuración, idioma, tema e integraciones MCP

## Abrir la configuración

La fila de la parte inferior izquierda de Inicio abre el panel de configuración (la línea de debajo muestra si hay una IA conectada). Tiene cinco secciones: Cuenta, IA, General, Integraciones y Acerca de.

También puede abrirla desde cualquier pestaña con **⌘,** (Ctrl+, en Windows y Linux), desde **Configuración…** en el menú de la aplicación en un Mac (el menú con el nombre de la app, a la izquierda de la barra de menús) o desde **Menú (☰) ▸ Configuración…** en Windows y Linux. En una pestaña de Word, ⌘, (Ctrl+,) es subíndice, así que ábrala desde el menú.

**Cuenta** muestra en qué estado están sus conexiones de Claude, ChatGPT y Codex, y **Gestionar conexiones** lleva a la sección IA. La IA tiene sus propios artículos: [Conexión por suscripción](help://subscription) y [Modelos de IA y ajustes](help://ai-models).

## Idioma

- La configuración ofrece **22 idiomas de interfaz**: inglés, chino simplificado, japonés, coreano, francés, alemán, español, tailandés, indonesio, ruso, árabe, portugués, italiano, polaco, checo, neerlandés, malayo, hebreo, hindi, chino tradicional, vietnamita, turco.
- El cambio se aplica de inmediato y se conserva; la barra de menús nativa se reconstruye con el idioma.

## Tema

Claro / Oscuro / Seguir el sistema. «Seguir el sistema» sigue la apariencia del sistema operativo, y los editores cambian de aspecto en sincronía sin parpadeos.

## General

- **Posición de la barra lateral de IA** (izquierda o derecha), **Tamaño del texto del panel de IA** y **Corrección ortográfica en el chat de IA**.
- **Panel de IA** — Desactivado, Contraído o Último estado.
- **Guardar automáticamente todos los documentos** activa el guardado automático de forma predeterminada en todos los editores; todavía puedes desactivarlo para una ventana.
- **Ubicación de guardado** con un botón **Cambiar** y **App predeterminada para documentos de Office** para reclamar .docx / .xlsx / .pptx para GenOffice.
- **Formato de guardado de nuevos documentos HWP** decide si se ofrece primero HWP o HWPX al guardar por primera vez un documento nuevo. Los documentos abiertos conservan su propio formato.
- **Fuentes de diapositivas con IA** define las fuentes que usa la IA en una presentación nueva cuando su solicitud no nombra ninguna. Elija Automático, Sin serifa, Con serifa o Títulos con serifa, y cambie por separado la fuente sin serifa y la fuente con serifa. Una plantilla de diseño elegida usa sus propias fuentes, y las páginas añadidas a una presentación con otras fuentes siguen esa presentación.

GenOffice no recopila ni envía estadísticas de uso, así que no hay ningún interruptor para ello.

## Editores e IA

Aquí elige qué editores usa y si usa la IA. La misma lista aparece además una vez en otros dos lugares: el paso **Elige tus editores** de las pantallas de bienvenida del primer arranque y una ventana que se muestra una sola vez en Inicio a quienes ya usaban GenOffice antes de que existiera este ajuste. Al principio todo está activado, así que si no toca nada no cambia nada. Los cambios se aplican al instante en todas las ventanas abiertas.

- **Editores**: Word, Excel, PowerPoint, PDF, Herramientas PDF, Markdown y texto, HTML, Mapa mental, Diagrama, HWP (Hangul) y Libro electrónico (EPUB). Las herramientas PDF se activan por separado del editor de PDF. Al menos un editor tiene que seguir activado.
- **Un editor desactivado** desaparece de las listas de documentos nuevos: las tarjetas de Inicio, el menú **+** de la barra de pestañas, Archivo ▸ Nuevo y la lista de aplicaciones predeterminadas. Los documentos ya abiertos siguen abiertos y las copias de recuperación se conservan.
- **Al abrir un archivo de un editor desactivado** (doble clic, arrastrar y soltar, Archivo ▸ Abrir, archivos recientes) se le pide elegir entre **Activar y abrir** y **Cancelar**. Si abre varios de sus archivos a la vez, se pregunta una sola vez.
- **Otras funciones que abrirían su resultado en un editor desactivado**, como convertir un PDF a ese formato, preguntan antes de empezar: **Activar y abrir**, **Solo crear el archivo** (el archivo se crea y se muestra en su carpeta, y el editor sigue desactivado) o **Cancelar**.
- **Con las funciones de IA desactivadas** desaparecen los paneles de IA, los botones y menús de IA, el panel de preguntas de Inicio, la ventana del agente y los avisos para conectar una IA, y las pestañas Cuenta, IA y Habilidades salen de la configuración. GenOffice no inicia ningún programa de IA desde sus pantallas. Los inicios de sesión, claves, habilidades y ajustes se conservan y vuelven al activar de nuevo la IA. Si todavía hay trabajo de IA en curso, primero se le pregunta si quiere **Detener y desactivar**.
- La línea de comandos, MCP y esta guía funcionan igual tanto si los editores o la IA están activados como si no.

Aunque la IA esté activada, no crea documentos nuevos para un editor desactivado; le indica que lo active aquí.

## IA ▸ Avanzado

Permanece cerrado hasta que se abre; la mayoría nunca lo necesita. La pestaña **Modelo de IA** contiene las claves de API y los servidores propios, para el chat. En la pestaña **Medios de IA y búsqueda**, cada capacidad elige el proveedor que la sirve, y la clave y la URL base de un proveedor se introducen una vez y se comparten:

- **Búsqueda web**, **Generación de imágenes**, **Análisis de imágenes** y **Análisis de vídeo**, cada una con un proveedor, un modelo, una clave y una URL base.
- La **búsqueda de archivos local** corre en esta máquina. Debajo, el **reranking de búsqueda Jev** está **desactivado por defecto**. Al activarlo, los extractos de los 20 primeros aciertos locales — hasta 1.200 caracteres por documento, más nombres de archivos y carpetas — van al punto final de decisión que elijas (Jev vía OpenRouter o TypeSafe, Perplexity, Liquid AI d1, Cloudflare, un motor local o una URL propia) para reordenarlos por relevancia. Desactivado, nada deja el dispositivo.
- **Permitir que las solicitudes automáticas usen una suscripción** está **desactivado por defecto**. Decide si una solicitud que llega de la línea de comandos o de un agente de codificación conectado puede usar tu suscripción de Claude o Codex; véase [Conectar un agente de programación](help://mcp).

## Acerca de

- **Versión**, la dirección del proyecto en GitHub y una línea que nombra el proyecto de código abierto en el que se basa esta aplicación.
- **Canal de actualización**: Estable o Beta. Cambiarlo surte efecto de inmediato y busca una actualización; no bajará una instalación Beta a Estable.

## Aplicaciones predeterminadas

La configuración puede registrar GenOffice como programa predeterminado para .docx / .xlsx / .pptx / .pdf y formatos similares (registro de aplicación predeterminada a nivel de plataforma; confirme cuando se le pida).

## Avisos de software de terceros y actualizaciones

- Ayuda ▸ Avisos de software de terceros: el inventario completo de licencias de código abierto que se distribuye con la aplicación.
- Menú (☰) ▸ Buscar actualizaciones (en un Mac, Ayuda ▸ Buscar actualizaciones): lanza una comprobación manual; si hay una versión más reciente, ofrece instalarla. En un Mac también está en el menú de la aplicación, justo debajo de «Acerca de GenOffice».

## Integración MCP (para usuarios avanzados / clientes de IA)

**Integraciones** es el panel que conecta GenOffice con un agente de programación, y tiene su propio artículo: Conectar un agente de programación. La versión corta: elija una vía (la línea de comandos o MCP), siga esa sección y después abra una conversación nueva y pregunte.

En **Servidor HTTP local**, la aplicación también puede ejecutar el servidor por su cuenta —un interruptor de activación y un puerto— y **Avanzado** añade la URL de comprobación de estado y el archivo de registro, en lugar de dejarlo en manos del asistente. Solo escucha en localhost.

En la parte superior de **Ajustes ▸ Integraciones**, **Servicios conectados** agrupa Google Drive, Notion, Canva, Bóveda de Obsidian, Korean Law MCP, kordoc MCP y tus servidores MCP personalizados encima de la conexión de agentes de código.

## Chuleta de la línea de comandos

| Comando             | Qué hace                      |
| ------------------- | ----------------------------- |
| `ieumoffice <file>` | abrir un archivo              |
| `ieumoffice mcp`    | iniciar el servidor MCP local |
| `ieumoffice --help` | todos los comandos y opciones |
