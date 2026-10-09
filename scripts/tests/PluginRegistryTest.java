import org.eclipse.core.runtime.adaptor.EclipseStarter;
import org.osgi.framework.Bundle;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;

/** Resolve the plugin and its actual Eclipse extensions in an isolated Equinox instance. */
public final class PluginRegistryTest {
    public static void main(String[] args) throws Exception {
        EclipseStarter.setInitialProperties(Map.of(
            "osgi.install.area", Path.of(args[0]).toUri().toString(),
            "osgi.configuration.area", Path.of(args[1]).toUri().toString(),
            "osgi.bundles", Path.of(args[2]).toUri() + "@1:start",
            "org.eclipse.equinox.simpleconfigurator.configUrl", Path.of(args[3]).toUri().toString(),
            "osgi.bundles.defaultStartLevel", "4",
            "osgi.noShutdown", "true"
        ));
        try {
            var framework = EclipseStarter.startup(new String[] { "-nosplash", "-consoleLog" }, null);
            for (String name : new String[] { "org.eclipse.equinox.registry", "org.eclipse.core.runtime", "org.eclipse.core.contenttype" }) {
                bundle(framework.getBundles(), name).start();
            }
            Bundle plugin = args.length > 5 && args[5].equals("installed")
                ? bundle(framework.getBundles(), "org.example.dbeaver.echarts")
                : framework.installBundle(Path.of(args[4]).toUri().toString());
            plugin.start();
            if (plugin.getState() != Bundle.ACTIVE) throw new AssertionError("Plugin unresolved");
            var assets = plugin.loadClass("org.example.dbeaver.echarts.WebAssets").getDeclaredMethod("resolve", String.class);
            assets.setAccessible(true);
            var index = (java.net.URL) assets.invoke(null, "web/index.html");
            if (!java.nio.file.Files.isRegularFile(Path.of(index.toURI()))) throw new AssertionError("Frontend did not resolve to a local file");
            if (args.length > 5 && args[5].equals("installed")) {
                for (String resource : new String[] { "LICENSE", "about.html", "web/js/echarts.min.js", "web/js/dashboard.js", "web/js/widget-editor.js", "web/js/world-map.js", "third-party" }) {
                    if (plugin.getEntry(resource) == null) throw new AssertionError("Installed resource missing: " + resource);
                }
                System.out.println("Installed bundle version: " + plugin.getVersion() + "; frontend: " + index);
            }
            Class<?> platform = bundle(framework.getBundles(), "org.eclipse.core.runtime")
                .loadClass("org.eclipse.core.runtime.Platform");
            Object manager = platform.getMethod("getContentTypeManager").invoke(null);
            String json = "{\"format\":\"dbeaver-echarts-dashboard\",\"schemaVersion\":1,\"widgets\":[]}";
            Object type = call(manager, "findContentTypeFor", new Class<?>[] { java.io.InputStream.class, String.class },
                new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)), "sample.echarts-dashboard.json");
            if (type == null || !"org.example.dbeaver.echarts.dashboard".equals(call(type, "getId", new Class<?>[0]))) {
                throw new AssertionError("Eclipse content manager did not select the dashboard type");
            }
            boolean reports = plugin.getVersion().getMajor() > 0 || plugin.getVersion().getMinor() >= 6;
            if (reports) {
                String report = "{\"format\":\"dbeaver-echarts-report\",\"schemaVersion\":1,\"sources\":[],\"widgets\":[]}";
                Object reportType = call(manager, "findContentTypeFor", new Class<?>[] { java.io.InputStream.class, String.class },
                    new ByteArrayInputStream(report.getBytes(StandardCharsets.UTF_8)), "sample.echarts-report.json");
                if (reportType == null || !"org.example.dbeaver.echarts.report".equals(call(reportType, "getId", new Class<?>[0]))) throw new AssertionError("Report content type missing");
                for (String resource : new String[] { "web/report.html", "web/js/report-model.js", "web/js/report-widgets.js", "web/js/report-execution.js", "web/js/report-export.js", "web/js/report-properties.js", "web/js/report-designer.js", "web/css/report-paper.css", "web/css/report-designer.css" }) {
                    if (plugin.getEntry(resource) == null) throw new AssertionError("Report resource missing: " + resource);
                }
            }
            Object registry = platform.getMethod("getExtensionRegistry").invoke(null);
            boolean editor = false, handler = false, reportEditor = false, reportHandler = false, reportView = false;
            for (String point : new String[] { "org.eclipse.ui.editors", "org.jkiss.dbeaver.resourceHandler", "org.eclipse.ui.views" }) {
                Object[] elements = (Object[]) call(registry, "getConfigurationElementsFor", new Class<?>[] { String.class }, point);
                for (Object element : elements) {
                    String className = (String) call(element, "getAttribute", new Class<?>[] { String.class }, "class");
                    if (className == null || !className.startsWith("org.example.dbeaver.echarts.")) continue;
                    // WorkbenchPart icon initialization needs a running workbench. Check
                    // the registered editor constructor here; exercise its page controller separately.
                    if (point.equals("org.eclipse.ui.editors")) {
                        Object instance = plugin.loadClass(className).getConstructor().newInstance();
                        editor |= instance.getClass().getName().endsWith("DashboardEditor");
                        reportEditor |= instance.getClass().getName().endsWith("ReportEditor");
                    }
                    // Navigator initialization requires the DBeaver application platform.
                    // Validate registration here; the running workbench owns activation.
                    handler |= className.endsWith("DashboardResourceHandler");
                    reportHandler |= className.endsWith("ReportResourceHandler");
                    if (className.endsWith("ReportDesignerView")) { plugin.loadClass(className).getConstructor().newInstance(); reportView = true; }
                }
            }
            if (!editor || !handler) throw new AssertionError("Dashboard editor or resource handler extension could not be instantiated");
            if (reports && (!reportEditor || !reportHandler || !reportView)) throw new AssertionError("Report view/editor/handler missing");
            System.out.println("Equinox registry tests OK: bundle resolved, JSON recognized, editor and navigator handler registered");
        } finally {
            EclipseStarter.shutdown();
        }
    }

    private static Bundle bundle(Bundle[] bundles, String name) {
        for (Bundle bundle : bundles) if (name.equals(bundle.getSymbolicName())) return bundle;
        throw new IllegalStateException("Missing bundle " + name);
    }
    private static Object call(Object object, String method, Class<?>[] parameters, Object... args) throws Exception {
        var operation = object.getClass().getMethod(method, parameters);
        operation.setAccessible(true);
        return operation.invoke(object, args);
    }
}
