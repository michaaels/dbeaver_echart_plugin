# Dashboards con SQL y JSON

El plugin guarda cada dashboard como un documento JSON versionado. Cada widget
conserva su SQL, la referencia a una conexión de DBeaver, el tipo de gráfico,
columnas, series, ejes, marcas, filtros, posición y política de actualización.
El mismo formato incluye los mapas y sus columnas de longitud, latitud y valor.

## Crear, guardar y abrir

1. Ejecuta un `SELECT` en DBeaver y configura el gráfico en la pestaña ECharts.
2. Pulsa **Add widget** y **Apply widget**. El widget conserva esa consulta y el resultado ya leído.
   Puedes ejecutar otra consulta y añadir otro widget al mismo dashboard.
3. En **Dashboard**, escribe el título y pulsa **Save dashboard**.
4. Elige el nombre. La carpeta propuesta es `Dashboards/ECharts` dentro del
   proyecto de la conexión. Se crean dos archivos:

   ```text
   Dashboards/ECharts/
     Control.echarts-dashboard.json
     Control.echarts-dashboard.sql
   ```

5. Usa **Files → Open dashboard** para abrir el JSON en su propio editor. Los JSON con
   el marcador de ECharts también tienen un editor y un manejador registrados
   para el navegador de ficheros de DBeaver. La conexión debe estar conectada;
   el archivo se abre con sus consultas detenidas. Pulsa **Review SQL**, revisa
   las consultas y conexiones, y usa **Run queries**. **Refresh all** pide esa
   misma revisión si alguna fuente aún no tiene aprobación.
6. En ese editor, **Save dashboard** o **Ctrl+S** actualiza ambos archivos.
   Los cambios pendientes aparecen como modificaciones del editor.

En **Files**, **Import** carga el documento en la vista actual; **Export** guarda el mismo
formato en otra ubicación, también con su copia SQL. El editor independiente
permite añadir gráficos y cambiar SQL/conexión, tipo, columnas, series, ejes,
actualización, filtros, título y renderer sin depender de una pestaña de resultados.

Los widgets nuevos con SQL usan consultas independientes y actualización manual.
Desde **Edit** puedes cambiar el SQL y la conexión. También puedes elegir
actualización periódica. Un widget sin SQL no puede guardarse como dashboard
reutilizable: asigna su consulta desde **Edit**. El SQL se conserva como texto;
las consultas con parámetros del editor SQL deben llevar valores concretos para
que el trabajo del dashboard pueda ejecutarlas.

## Crear gráficos dentro del dashboard

1. Pulsa **Add widget**, incluso en el editor independiente o un dashboard vacío.
2. Escribe el título, selecciona la conexión y escribe el SQL de ese gráfico.
3. Pulsa **Run preview** para ejecutar la consulta que estás viendo. Aparecen
   las columnas, una tabla con las primeras diez filas y una vista previa del gráfico.
4. Elige tipo de gráfico, categoría X, series numéricas Y y eje izquierdo/derecho.
   Un **Gauge** admite una consulta con una sola columna numérica. Usa alias únicos
   para las columnas devueltas y el SQL para agrupar los datos que necesites.
5. Elige actualización manual o periódica y pulsa **Apply widget**.
6. Guarda el dashboard con **Save dashboard** o **Ctrl+S** para conservar SQL,
   conexiones, gráficos y distribución en JSON y su copia SQL.

Cada widget puede consultar tablas, SQL y conexiones diferentes. **Edit**, en la
cabecera de cada widget, abre esta misma ventana. Los borradores sobreviven a los
refrescos del dashboard; **Cancel** o **Escape** los descarta. **Stop preview**
cancela solamente la consulta de la vista previa. Aplicar una vista previa utiliza
su resultado sin volver a ejecutar el SQL.

Puedes editar y aplicar el SQL de un widget existente sin ejecutar una vista previa,
conservando sus nombres de columnas. En ese caso su aprobación se invalida y tendrás
que revisar/ejecutar la consulta antes del refresco. Para un widget nuevo, ejecuta
una vista previa para disponer de las columnas y configurar su gráfico.

## Revisar y detener consultas

La aprobación dura solamente durante la sesión de ese dashboard. Reabrir/importar
un archivo o cambiar su SQL/conexión obliga a revisar la fuente de nuevo. No se
guardan marcas de confianza en JSON ni en la copia SQL. Mover, redimensionar,
renombrar o filtrar un widget conserva la aprobación de su fuente. **Run preview**
es una ejecución explícita del SQL y conexión visibles en el editor; si aplicas
ese mismo borrador, conserva la aprobación durante esa sesión.

**Stop queries** solicita la cancelación de las consultas y pausa los intervalos;
el botón **Stop** de un widget permite hacerlo individualmente. **Refresh** o
**Refresh all** reanuda consultas aprobadas. Un error o timeout pausa la consulta
afectada hasta que la actualices explícitamente.

En **Window > Preferences > ECharts**, el timeout predeterminado es 30 segundos,
con rango de 1 a 3600. Se ejecutan como máximo cuatro consultas simultáneas y
cada una abre su propio contexto, separado de las transacciones del editor SQL.
Las conexiones configuradas para usar una única sesión no pueden ejecutar estas
consultas independientes. El soporte de cancelación/timeout depende del driver.

El filtro SQL descarta lotes, operaciones de escritura/bloqueo y ciertas funciones
con efectos secundarios; no garantiza que toda función `SELECT` sea inocua.
Usa permisos de lectura en la base de datos para dashboards de control.

## Mover y redimensionar widgets

Arrastra el botón **⠿** o el espacio de la cabecera para mover un widget. Para
cambiar su ancho y alto, arrastra cualquiera de sus cuatro bordes o sus cuatro
esquinas. El cursor indica la dirección; el borde contrario mantiene su posición.
El gráfico se adapta durante el redimensionado y el contorno
indica dónde quedará. Al soltar, los widgets que se crucen se recolocan sin
solaparse. **Escape** cancela el gesto. El área se desplaza al acercar el ratón
a sus bordes durante un arrastre.

El título sigue siendo editable con un clic, y el cuerpo del gráfico conserva
sus interacciones. También puedes enfocar los botones de mover/redimensionar
y usar las flechas del teclado. Guarda el dashboard para conservar el diseño.

El JSON registra `layout: { x, y, width, height }` para cada widget: posiciones
desde cero, ancho en una cuadrícula de 12 columnas y alto en filas de 40 px,
con separación de 8 px. El ancho mínimo es 4 columnas y el alto mínimo 5 filas.
Los diseños antiguos con `columnSpan`/`rowSpan` se convierten automáticamente.
En ventanas estrechas la cuadrícula permite desplazamiento horizontal y
conserva las posiciones guardadas.

## Qué archivo editar

El **JSON es el documento principal**. El `.sql` es una copia generada, organizada
por widget, para consultar, reutilizar o versionar las consultas. Edita el SQL
desde **Edit** o dentro del JSON y vuelve a guardar. Cambiar solamente el `.sql`
no modifica el dashboard y ese archivo se regenera en el siguiente guardado.

Los archivos anteriores con `schemaVersion: 1` se admiten cuando contienen SQL
en todos sus widgets. Las referencias al resultado activo se convierten a
consultas guardadas. Un archivo anterior sin SQL necesita completar sus fuentes
en la vista del resultado antes de exportarlo.

Se guardan nombre/ID de conexión y proyecto, sin copiar la configuración JDBC
ni sus credenciales. Si mueves un dashboard a otro workspace, elige la conexión
local desde **Edit → Connection → Apply widget**. Los IDs de conexión son referencias locales.
Los archivos antiguos que solo tienen el nombre usan una coincidencia única en
su proyecto; un ID inexistente requiere elegir otra conexión explícitamente.

El JSON admite hasta 24 widgets y 1 MiB. Los guardados validan el documento y
reemplazan cada archivo mediante un temporal. Los dos reemplazos no forman una
transacción: si falla el guardado del JSON, su contenido anterior sigue siendo
el principal y al volver a guardarlo se regenera la copia SQL. El editor avisa
si el JSON cambió en disco desde que se abrió.

## Ejemplo y pruebas

`dev/dashboards/control-ventas.echarts-dashboard.json` incluye líneas, barras y
un mapa de ciudades de Ecuador. Usa las tablas sintéticas de
`dev/mariadb/seed.sql`; elige tu conexión en **Edit** si su nombre o proyecto
no coincide con `General / test_hop_mcp`.

Desde la raíz del repositorio, con JDK 21 y Node disponibles:

```powershell
npm install --prefix .dev/browser-tests --no-audit --no-fund linkedom@0.18.13
.\scripts\validate.ps1 -DBeaverPlugins .dev\dbeaver-26.2.2\dbeaver\plugins
node scripts/test-plugin-registry.js
```

Para probar los gestos reales con ratón/teclado y ECharts en Edge sin abrir una
ventana visible, genera primero los datasets de MariaDB descritos abajo y ejecuta:

```powershell
npm install --prefix .dev/browser-tests --no-audit --no-fund --no-save playwright@1.63.0
node scripts/test-dashboard-browser.js
```

La prueba incluye movimiento, redimensionado, Escape, edición del título,
guardado/reapertura, tema oscuro y una ventana estrecha. La captura se guarda
en `.dev/screenshots/dashboard-layout.png`. Usa una sesión aislada de Edge;
no controla la sesión de DBeaver abierta por el usuario.

La validación compila el plugin contra DBeaver y comprueba el esquema portátil,
SQL Unicode, fuentes independientes, reapertura sin resultado activo, selección
de conexión, refresh y archivos inválidos. La prueba Equinox usa una instancia
aislada: comprueba resolución de dependencias, detección del JSON y registro del
editor y del manejador de recursos. No abre el workbench ni prueba doble clic
en el navegador de ficheros de la sesión interactiva.

Para las pruebas de datos reales:

```powershell
python -m pip install --target .dev/python-packages PyMySQL==1.2.3
python scripts/mariadb-fixtures.py --seed
node scripts/render-mariadb-gallery.js
```

El runner pide la URI sin mostrarla, exige TLS y crea únicamente las tres tablas
`echarts_test_*` de prueba. Las inserciones son repetibles. Se verifican 15
consultas; la galería `.dev/mariadb-gallery/index.html` contiene 30 renders SVG
de los 12 tipos de gráfico, después de serializar y restaurar su configuración.
Estas pruebas no certifican las interacciones Canvas/SWT ni todo el flujo SQL
del workbench abierto.

## Uso futuro en la web

El formato JSON y el código de gráficos son reutilizables en un visor web.
La ejecución SQL sigue dentro de DBeaver. Para abrir dashboards con datos
actualizados en la web hará falta un servicio que resuelva las fuentes y ejecute
las consultas con sus conexiones; no se implementa ese servicio en este cambio.
La vista previa de desarrollo usa datos de ejemplo y no se conecta a MariaDB.
