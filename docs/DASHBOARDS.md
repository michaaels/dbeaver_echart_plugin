# Dashboards con SQL y JSON

El plugin guarda cada dashboard como un documento JSON versionado. Cada widget
conserva su SQL, la referencia a una conexión de DBeaver, el tipo de gráfico,
columnas, series, ejes, marcas, filtros, posición y política de actualización.
El mismo formato incluye los mapas y sus columnas de longitud, latitud y valor.

## Crear, guardar y abrir

1. Ejecuta un `SELECT` en DBeaver y configura el gráfico en la pestaña ECharts.
2. Pulsa **Add widget**. El widget conserva esa consulta y el resultado ya leído.
   Puedes ejecutar otra consulta y añadir otro widget al mismo dashboard.
3. En **Dashboard**, escribe el título y pulsa **Save dashboard**.
4. Elige el nombre. La carpeta propuesta es `Dashboards/ECharts` dentro del
   proyecto de la conexión. Se crean dos archivos:

   ```text
   Dashboards/ECharts/
     Control.echarts-dashboard.json
     Control.echarts-dashboard.sql
   ```

5. Usa **Open dashboard** para abrir el JSON en su propio editor. Los JSON con
   el marcador de ECharts también tienen un editor y un manejador registrados
   para el navegador de ficheros de DBeaver. La conexión debe estar conectada;
   **Refresh all** vuelve a ejecutar las consultas de los widgets.
6. En ese editor, **Save dashboard** o **Ctrl+S** actualiza ambos archivos.
   Los cambios pendientes aparecen como modificaciones del editor.

**Import** carga el documento en la vista actual; **Export** guarda el mismo
formato en otra ubicación, también con su copia SQL. El editor independiente
permite cambiar SQL/conexión, actualización, filtros, título y renderer. Para
añadir nuevos gráficos, usa la presentación ECharts de un resultado SQL.

Los widgets nuevos con SQL usan consultas independientes y actualización manual.
Desde **Source** puedes cambiar el SQL y la conexión. También puedes elegir
actualización periódica. Un widget sin SQL no puede guardarse como dashboard
reutilizable: asigna su consulta desde **Source**. El SQL se conserva como texto;
las consultas con parámetros del editor SQL deben llevar valores concretos para
que el trabajo del dashboard pueda ejecutarlas.

## Qué archivo editar

El **JSON es el documento principal**. El `.sql` es una copia generada, organizada
por widget, para consultar, reutilizar o versionar las consultas. Edita el SQL
desde **Source** o dentro del JSON y vuelve a guardar. Cambiar solamente el `.sql`
no modifica el dashboard y ese archivo se regenera en el siguiente guardado.

Los archivos anteriores con `schemaVersion: 1` se admiten cuando contienen SQL
en todos sus widgets. Las referencias al resultado activo se convierten a
consultas guardadas. Un archivo anterior sin SQL necesita completar sus fuentes
en la vista del resultado antes de exportarlo.

Se guardan nombre/ID de conexión y proyecto, sin copiar la configuración JDBC
ni sus credenciales. Si mueves un dashboard a otro workspace, elige la conexión
local desde **Source → Use SQL**. Los IDs de conexión son referencias locales.
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
`dev/mariadb/seed.sql`; elige tu conexión en **Source** si su nombre o proyecto
no coincide con `General / test_hop_mcp`.

Desde la raíz del repositorio, con JDK 21 y Node disponibles:

```powershell
npm install --prefix .dev/browser-tests --no-audit --no-fund linkedom@0.18.13
.\scripts\validate.ps1 -DBeaverPlugins .dev\dbeaver-26.2.2\dbeaver\plugins
node scripts/test-plugin-registry.js
```

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
