# Revisión de producción del plugin independiente

Fecha de revisión: 2026-10-08. Estado: beta funcional; todavía no certificada
para producción. Esta revisión identifica lo observado en el código y las
pruebas disponibles; no sustituye una auditoría completa.

El proyecto continuará como plugin independiente. La integración en el repositorio
principal de DBeaver queda fuera del alcance de esta entrega.

## Controles de ejecución implementados

Abrir/importar un dashboard ya no ejecuta SQL. **Review SQL** muestra cada consulta
y su conexión; **Run queries** crea una aprobación temporal ligada a la fuente,
verificada también por Java. Cambiar SQL/conexión o reabrir el documento la invalida.
El lexer reemplaza la regex anterior, distingue literales/comentarios y bloquea
lotes, escrituras, bloqueos y varias funciones conocidas con efectos secundarios.
Las funciones de usuario y diferencias entre dialectos siguen requiriendo permisos
de lectura efectivos en la base de datos.

Cada consulta abre y cierra un contexto aislado, sin usar ni cerrar la sesión del
editor. Hay cuatro slots globales, timeout configurable de 30 segundos y cancelación
del statement fuera del hilo UI. **Stop** pausa intervalos; los errores también
pausan la fuente afectada. La terminación real depende del driver, especialmente
durante conexión y lectura; no se fuerza la terminación de hilos.

`DashboardQueryControlsTest` comprueba política SQL, aprobación, timeout, cancelación,
propiedad del contexto y concurrencia con el planificador real de Eclipse. Usa
proxies para el driver y un servicio mínimo de workbench en una JVM de pruebas,
sin escribir en MariaDB. Las pruebas DOM y Edge comprueban revisión, reapertura,
edición de fuentes, Stop, intervalos, callbacks tardíos y SQL mostrado como texto.
Queda completar la certificación con drivers y SWT reales.

## Problema visual corregido

La leyenda no duplicaba sus textos: los nombres de los ejes Y estaban dibujados
en la misma franja. En `analytics.js` se reservó espacio para esa fila y se
habilitó `axisLabel.hideOverlap`, también para el eje de tiempo.

`scripts/test-chart-labels.js` reproduce el problema anterior y comprueba los
rectángulos de los textos en ECharts real. Pasan 24 combinaciones: línea/barras,
Canvas/SVG, claro/oscuro y anchos de 320, 600 y 920 px, con dos ejes Y y 90 fechas.
También volvió a pasar la prueba de movimiento, tamaño y reapertura del dashboard.

Queda probar nombres extensos, muchas series, tamaños mínimos de widget,
escalado de pantalla de 125/150/200 %, otros idiomas y las plataformas SWT.

## Edición de widgets en el dashboard

El editor independiente ya permite añadir widgets con SQL/conexión propios,
ejecutar una vista previa y seleccionar tipo, columnas, series y ejes. **Edit**
reemplaza el editor desplegable que podía quedar fuera del área visible del widget.
Los borradores están separados del modelo guardado y sobreviven a refrescos;
Apply reutiliza los datos de la vista previa y Cancel/Escape los descarta.
Los mensajes de carga/error tampoco cubren ahora los botones de la cabecera.

Las pruebas DOM y Edge comprueban creación sin resultado activo, consultas
independientes, cambio de conexión/tipo, columnas inferidas, doble eje, gauge de
una columna, cancelación de preview, conservación de borradores y guardado/reapertura.
Al validar la vista previa se corrigió también la escala de barras para incluir
el cero; así el valor positivo más pequeño no desaparece en el límite del eje.

## Antes de una versión de producción

| Prioridad | Pendiente y evidencia | Criterio de cierre |
|---|---|---|
| P0 | **SQL y confianza: controles implementados; certificación pendiente.** Revisión explícita, aprobación en memoria ligada a SQL/conexión y lexer conservador. | Verificar los dialectos/roles admitidos con bases reales y revisión de seguridad. Documentar rechazos del lexer; no presentarlo como garantía de lectura sin efectos secundarios. |
| P0 | **Tiempo, cancelación y aislamiento: controles implementados; drivers pendientes.** Statement timeout + deadline, cancelación asíncrona, contexto propio y cuatro jobs concurrentes. | Probar consultas bloqueadas, transacciones del editor, apertura de conexión, fetching, desconexión y cierre con drivers reales. Publicar el alcance del soporte de cancelación por driver. |
| P0 | **Instalación y actualización: empaquetado local implementado.** Build automático desde fuentes con bytecode 21, feature fijada al bundle y ZIP P2 versionado con checksum y metadatos del build. Instalación/desinstalación/reinstalación comprobadas en DBeaver oficial 26.2.2 limpio con Java incluido; recursos y licencias verificados en el bundle instalado. | Completar actualización entre entregas, CI con target fijado, firma y canal público de distribución. Los timestamps del publisher impiden prometer hashes idénticos entre builds. |
| P0 | **Pruebas del producto.** Compilación y registros se verificaron en DBeaver 26.2.2; Edge automatizado usa un puente SQL simulado con datasets de MariaDB. | Completar la prueba SWT con consultas reales: abrir/guardar, Ctrl+S, dirty state, conexiones, refresco, cierre durante consultas, zoom, exportación y reinicio. Certificar Windows/Linux/macOS o publicar explícitamente un alcance menor. |
| P1 | **Memoria y fluidez.** Hay límites por snapshot, pero hasta 24 widgets; cada render del dashboard destruye y crea sus gráficos. | Medir un dashboard de 24 widgets y consultas al límite; fijar presupuesto global, actualizar sólo widgets afectados y comprobar liberación de gráficos, jobs, observers y timers. |
| P1 | **Datos y filtros.** Los filtros actúan en el snapshot ya obtenido; los límites pueden truncarlo. No hay parámetros SQL reutilizables. | Mostrar claramente datos parciales, fecha de actualización y errores por widget; probar NULL, decimales, enteros grandes, zonas horarias y categorías repetidas. Definir si los filtros son locales o parámetros de consultas antes de presentar los indicadores como totales. |
| P1 | **UX y accesibilidad.** Textos de interfaz mayoritariamente fijos en inglés; controles de mover/tamaño tienen ARIA, pero falta certificar el contenido de los gráficos. | Catálogo de traducciones, navegación con teclado, contraste/lector de pantalla, estados de carga correctos en el editor independiente, guardado y selección de conexión comprensibles. |
| P1 | **Formato y evolución.** JSON versión 1 y escritura atómica por archivo ya existen; el par JSON/SQL no es una transacción y sus validaciones Java/JS son diferentes. | Esquema documentado y compartido, migraciones y fixtures, pruebas de archivos inválidos y fallos de guardado, detección de cambios externos y recuperación. Mantener el JSON como autoridad y explicar que el SQL es generado. |
| P1 | **Identidad y mantenimiento.** Bundles y feature usan `org.example` y proveedor `Example`; las dependencias no tienen rangos de versiones certificados. | Elegir identidad estable antes de publicar, fijar compatibilidad, mantener changelog, política de versiones y responsable de soporte. |

### Comprobación del filtro SQL

La revisión inicial llamó únicamente al filtro anterior, sin ejecutar SQL. Los
casos detectados ahora se verifican en `DashboardQueryControlsTest`:

- `SELECT 1`: aceptado.
- `SELECT 1 INTO OUTFILE '/tmp/audit-no-execution'`: ahora rechazado.
- `SELECT nextval('audit_sequence')`: ahora rechazado.
- `SELECT 'update' AS status`: ahora aceptado como literal.

El objetivo de lectura requiere tanto una política de ejecución como permisos
efectivos. Los límites de filas no limitan el trabajo de agregaciones o funciones
en el servidor. No se hicieron pruebas destructivas en MariaDB.

### Compilador de Eclipse

El workspace estaba configurado para Java 26 y podía generar bytecode 70 aunque
el manifiesto declare Java 21. Se añadió la preferencia del proyecto para Java 21
y una comprobación en `test-plugin-registry.js --pde-output` que rechaza bytecode
posterior a 65, además de detectar clases faltantes y errores de compilación.
Las pruebas de fuentes usan `--release 21`. La ejecución local sigue usando Java
26; esto no certifica una ejecución completa del producto en Java 21.

## Secuencia recomendada

1. Certificar los controles de ejecución con drivers reales y permisos de lectura.
2. Construir una entrega P2 y probarla instalada en limpio.
3. Completar pruebas SWT, rendimiento y compatibilidad del alcance elegido.
4. Publicar una beta instalable con pendientes explícitos; certificar la versión estable después de cerrar los criterios.
5. Evolucionar el formato y preparar un visor web separado cuando se defina su alcance.

La futura apertura en web necesita su propio visor y, para consultar datos
actualizados, un backend autenticado que gestione conexiones y permisos. Los
archivos ya conservan SQL y configuración, pero no constituyen ese servicio ni
un snapshot completo de los resultados. No es necesario construir el visor web
para entregar una primera versión del plugin de escritorio.

## Repetir pruebas visuales

```powershell
npm install --prefix .dev/browser-tests --no-audit --no-fund --no-save playwright@1.63.0
node scripts/test-chart-labels.js
node scripts/test-dashboard-browser.js
```

La segunda prueba requiere los datasets descritos en `DASHBOARDS.md`. Son sesiones
aisladas de Edge sin interfaz visible; no operan el DBeaver del usuario.
