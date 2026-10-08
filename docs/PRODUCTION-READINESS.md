# Revisión de producción e integración en DBeaver

Fecha de revisión: 2026-10-07. Estado: beta funcional; todavía no certificada
para producción. Esta revisión identifica lo observado en el código y las
pruebas disponibles; no sustituye una auditoría completa.

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

## Antes de una versión de producción

| Prioridad | Pendiente y evidencia | Criterio de cierre |
|---|---|---|
| P0 | **SQL y confianza al abrir archivos.** `DashboardQueryJob.isReadOnlyQuery` usa regex; `chart.js` solicita consultas guardadas al abrir el dashboard, incluso con política manual. | Revisar consultas y conexiones antes de ejecutar un archivo importado, definir confianza para documentos locales y respaldar el acceso con permisos de base de datos. Evaluar el parser y las APIs de ejecución de DBeaver, sin tratar un parser o regex como garantía de ausencia de efectos secundarios. |
| P0 | **Tiempo, cancelación y contexto de ejecución.** El job limita filas y comprueba el monitor durante la lectura, pero no fija un timeout propio ni conserva el statement para cancelarlo. `DashboardConnections` usa el contexto predeterminado de la conexión. | Una consulta bloqueada debe detenerse; definir y probar aislamiento respecto al editor/transacciones, concurrencia por conexión, límites globales y recuperación tras desconexión. No reintentar automáticamente consultas de efectos desconocidos. |
| P0 | **Instalación y actualización.** Existen feature y definición del sitio PDE; no hay build automatizado de una entrega P2 ni CI versionada. Las pruebas actuales compilan fuentes o empaquetan un JAR de pruebas. | Build reproducible con target fijado, artefacto P2 versionado y publicable, instalación/actualización/desinstalación en un DBeaver limpio y verificación de las licencias y recursos incluidos. |
| P0 | **Pruebas del producto.** Compilación y registros se verificaron en DBeaver 26.2.2; Edge automatizado usa un puente SQL simulado con datasets de MariaDB. | Completar la prueba SWT con consultas reales: abrir/guardar, Ctrl+S, dirty state, conexiones, refresco, cierre durante consultas, zoom, exportación y reinicio. Certificar Windows/Linux/macOS o publicar explícitamente un alcance menor. |
| P1 | **Memoria y fluidez.** Hay límites por snapshot, pero hasta 24 widgets; cada render del dashboard destruye y crea sus gráficos. | Medir un dashboard de 24 widgets y consultas al límite; fijar presupuesto global, actualizar sólo widgets afectados y comprobar liberación de gráficos, jobs, observers y timers. |
| P1 | **Datos y filtros.** Los filtros actúan en el snapshot ya obtenido; los límites pueden truncarlo. No hay parámetros SQL reutilizables. | Mostrar claramente datos parciales, fecha de actualización y errores por widget; probar NULL, decimales, enteros grandes, zonas horarias y categorías repetidas. Definir si los filtros son locales o parámetros de consultas antes de presentar los indicadores como totales. |
| P1 | **UX y accesibilidad.** Textos de interfaz mayoritariamente fijos en inglés; controles de mover/tamaño tienen ARIA, pero falta certificar el contenido de los gráficos. | Catálogo de traducciones, navegación con teclado, contraste/lector de pantalla, estados de carga correctos en el editor independiente, guardado y selección de conexión comprensibles. |
| P1 | **Formato y evolución.** JSON versión 1 y escritura atómica por archivo ya existen; el par JSON/SQL no es una transacción y sus validaciones Java/JS son diferentes. | Esquema documentado y compartido, migraciones y fixtures, pruebas de archivos inválidos y fallos de guardado, detección de cambios externos y recuperación. Mantener el JSON como autoridad y explicar que el SQL es generado. |
| P1 | **Identidad y mantenimiento.** Bundles y feature usan `org.example` y proveedor `Example`; las dependencias no tienen rangos de versiones certificados. | Elegir identidad estable antes de publicar, fijar compatibilidad, mantener changelog, política de versiones y responsable de soporte. |

### Comprobación del filtro SQL

Una prueba local llamó únicamente a `isReadOnlyQuery`, sin conectar ni ejecutar
estos SQL. Confirmó:

- `SELECT 1`: aceptado.
- `SELECT 1 INTO OUTFILE '/tmp/audit-no-execution'`: aceptado aunque puede escribir un archivo según los permisos del servidor.
- `SELECT nextval('audit_sequence')`: aceptado aunque puede cambiar una secuencia.
- `SELECT 'update' AS status`: rechazado aunque el texto es un literal.

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

## Solicitar integración en el proyecto principal

El primer paso es acordar el alcance con los mantenedores. La documentación
oficial reserva los gráficos de resultados para Lite, Enterprise y Ultimate;
la guía advierte que funciones existentes en ediciones comerciales pueden no
aceptarse en Community. Esto plantea un riesgo de aceptación del alcance actual,
independiente de la calidad técnica.

Fuentes: [Managing Charts](https://github.com/dbeaver/dbeaver/wiki/Managing-Charts)
y [Contribute your code](https://github.com/dbeaver/dbeaver/wiki/Contribute-your-code).

Propuesta inicial: describir un renderer ECharts local para resultados y su
formato reutilizable, explicar cómo encajaría con los dashboards existentes y
consultar si prefieren un componente integrado o una extensión independiente.
Los [dashboards existentes](https://github.com/dbeaver/dbeaver/wiki/Dashboards)
también necesitan considerarse para evitar dos experiencias incompatibles.

Si aceptan la propuesta, adaptar nombres y estilo, NLS, anotaciones de nulabilidad
y cabeceras; integrar el módulo en `plugins/pom.xml` y la feature indicada por
ellos. Su guía pide un issue previo, commits referenciándolo, pruebas dentro de
DBeaver, capturas y declaración del uso de IA. Recomienda cambios pequeños;
un envío masivo de código generado con IA puede rechazarse.

El PR de este repositorio no es un PR contra `dbeaver/dbeaver`. No se abrió un
issue ni se contactó a sus mantenedores durante esta revisión.

## Secuencia recomendada

1. Consultar la aceptación del alcance y cerrar P0 de SQL/ejecución.
2. Construir una entrega P2 y probarla instalada en limpio.
3. Completar pruebas SWT, rendimiento y compatibilidad del alcance elegido.
4. Publicar una beta instalable con pendientes explícitos; certificar la versión estable después de cerrar los criterios.
5. Preparar contribuciones acotadas al repositorio principal si los mantenedores aceptan el diseño.

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
