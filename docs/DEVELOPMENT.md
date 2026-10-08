# Desarrollo y vista previa

Hay dos formas complementarias de ver los cambios del plugin.

## Vista previa rápida en el navegador

Desde la raíz del repositorio:

```powershell
node scripts/preview.js
```

Abre <http://127.0.0.1:8765>. El servidor usa los mismos HTML, CSS y JavaScript
que el plugin, carga 90 filas de ejemplo y recarga la página al guardar archivos.
Puedes probar tipos de gráfico, series, ejes, Canvas/SVG y dashboards. La
configuración se conserva en el almacenamiento local del navegador.

Esta vista no ejecuta SQL ni prueba las APIs Java/SWT. Las consultas de widgets
muestran un mensaje que indica que deben probarse dentro de DBeaver. Ctrl+C
detiene el servidor. Para otro puerto, define `ECHARTS_PREVIEW_PORT`.

## Configurar Eclipse PDE

Requisitos: Eclipse con Plug-in Development Environment, JDK 21 para el plugin
y una distribución Windows x86_64 de DBeaver Community. Eclipse puede usar su
propio JDK más reciente; el código del plugin se compila para Java 21. En esta
configuración DBeaver 26.2.2 se ejecuta con el JDK 26 ya instalado.

Para descargar la última versión estable oficial, verificar su SHA-256,
descomprimirla en `.dev/` y generar la configuración local:

```powershell
.\scripts\install-dev-dbeaver.ps1
```

También puedes elegir una versión concreta con `-Version 26.2.2`, o utilizar
una instalación existente:

```powershell
.\scripts\configure-eclipse.ps1 -DBeaverHome C:\ruta\dbeaver -JdkHome C:\ruta\jdk-21 -RuntimeJdkHome C:\ruta\jdk-26
```

El script compila todo el plugin con `--release 21` contra los bundles de esa
instalación y crea estos archivos locales, excluidos de Git:

- `dev/DBeaver-local.target`
- `dev/DBeaver-ECharts-local.launch`

En Eclipse:

1. Importa los proyectos existentes de `dev/`, `plugins/`, `features/` y `sites/`.
2. En **Window → Preferences → Java → Installed JREs**, registra los JDK de
   compilación y ejecución. Sus nombres deben coincidir con los nombres de sus
   carpetas usados por el script.
3. Abre `DBeaver-local.target` y pulsa **Set as Active Target Platform**.
4. Ejecuta **Project → Clean** y comprueba que no hay errores de compilación.
5. Abre **Run → Run Configurations → Eclipse Application → DBeaver-ECharts-local**
   y pulsa **Run** o **Debug**.

La ejecución usa `${workspace_loc}/../dbeaver-echarts-runtime`, separado del
workspace de Eclipse. Conserva sus conexiones y no limpia los datos al reiniciar.
El directorio de trabajo es la instalación de DBeaver, donde están sus DLL de SWT.
La configuración también define `java.library.path` con esa carpeta para que
Java encuentre las bibliotecas nativas al iniciar desde PDE.
La plataforma usa el DBeaver descargado, mientras PDE sustituye el bundle de
ECharts por el proyecto del workspace.

Como los archivos también se modifican desde fuera de Eclipse, activa
**Window → Preferences → General → Workspace → Refresh using native hooks or
polling**. Eclipse debe descubrir las clases nuevas y los cambios del manifiesto
antes de compilar. Mantén **Project → Build Automatically** activado.

Si aparece `Unresolved compilation problems`, `DashboardFiles cannot be resolved`
o `DashboardConnections cannot be resolved`, la salida `bin/` usada por PDE puede
estar incompleta aunque la compilación de la validación haya pasado. Eclipse puede
generar clases que lanzan ese error al construir la presentación.

1. Guarda tus editores y cierra la ejecución de DBeaver de pruebas.
2. Selecciona `org.example.dbeaver.echarts` en Eclipse y pulsa **F5 / Refresh**.
3. Ejecuta **Project → Clean** para ese proyecto y espera a que termine el build.
4. Revisa la vista **Problems** y corrige cualquier error antes de volver a ejecutar
   `DBeaver-ECharts-local`. Si Eclipse avisa que hay errores, cancela el lanzamiento.

Para comprobar las clases que realmente usa PDE, sin recompilarlas ni abrir otra
ventana de DBeaver:

```powershell
node scripts/test-plugin-registry.js --pde-output
```

Esta variante detecta clases faltantes y las clases con errores generadas por
Eclipse y bytecode que requiere una versión posterior a Java 21; después verifica los registros del plugin en una instancia Equinox
aislada. La variante sin `--pde-output` compila los fuentes en un directorio de
pruebas independiente.

El proyecto fija su compilador en `.settings/org.eclipse.jdt.core.prefs` para
Java 21. Esto evita heredar un compilador Java 26 del workspace aunque la
ejecución local de DBeaver use Java 26. Refresca el proyecto y vuelve a compilar
después de cambiar esas preferencias.

Un mensaje distinto, `Connection is closed` precedido por `Connection reset`,
indica que se perdió la conexión de la base de datos. Reconecta la conexión de
pruebas en DBeaver y vuelve a ejecutar el SQL; refrescar el proyecto Java no
restablece esa conexión.

Si aparece `UnsatisfiedLinkError: Could not load SWT library`, vuelve a generar
la configuración con `configure-eclipse.ps1`, selecciona el proyecto
`echarts-development` en Eclipse y pulsa **F5**. Abre la configuración de
ejecución `DBeaver-ECharts-local`: en **Arguments**, el directorio de trabajo y
el argumento `-Djava.library.path` deben apuntar a la instalación de DBeaver.
Pulsa **Apply** y **Run**. Los avisos de NLS o módulos incubadores no son la
causa de este error.

## Ver los gráficos dentro de DBeaver

Crea una conexión SQLite de prueba, abre `dev/sample-query.sql`, ejecuta la
consulta y selecciona la presentación **ECharts** en el resultado. Usa `fecha`
o `region` como X y `ventas`/`costos` como Y. Para el mapa, usa `longitud` como X
y `latitud` como primera serie Y.

Guarda los cambios de Java y reinicia la ejecución PDE. Para cambios web,
reabre la presentación o reinicia el DBeaver de pruebas para recargar los
recursos. En **Debug** puedes poner puntos de interrupción en las clases Java.

La vista del navegador facilita la iteración visual. La ejecución PDE verifica
lectura del ResultSet, consultas SQL, temas, portapapeles y el navegador SWT.

## Validación

La guía [Dashboards con SQL y JSON](DASHBOARDS.md) explica el guardado en el
proyecto, el editor independiente y las pruebas automáticas con MariaDB.

Ejecuta `scripts/validate.ps1 -DBeaverPlugins <DBeaverHome>\plugins` con JDK 21
en el PATH. La compilación por sí sola no certifica todos los flujos del plugin;
el checklist de `docs/COMPATIBILITY.md` describe las pruebas de ejecución.
