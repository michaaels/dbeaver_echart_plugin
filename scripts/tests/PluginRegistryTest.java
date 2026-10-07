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
            Bundle plugin = framework.installBundle(Path.of(args[4]).toUri().toString());
            plugin.start();
            if (plugin.getState() != Bundle.ACTIVE) throw new AssertionError("Plugin unresolved");
            Class<?> platform = bundle(framework.getBundles(), "org.eclipse.core.runtime")
                .loadClass("org.eclipse.core.runtime.Platform");
            Object manager = platform.getMethod("getContentTypeManager").invoke(null);
            String json = "{\"format\":\"dbeaver-echarts-dashboard\",\"schemaVersion\":1,\"widgets\":[]}";
            Object type = call(manager, "findContentTypeFor", new Class<?>[] { java.io.InputStream.class, String.class },
                new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)), "sample.echarts-dashboard.json");
            if (type == null || !"org.example.dbeaver.echarts.dashboard".equals(call(type, "getId", new Class<?>[0]))) {
                throw new AssertionError("Eclipse content manager did not select the dashboard type");
            }
            Object registry = platform.getMethod("getExtensionRegistry").invoke(null);
            boolean editor = false, handler = false;
            for (String point : new String[] { "org.eclipse.ui.editors", "org.jkiss.dbeaver.resourceHandler" }) {
                Object[] elements = (Object[]) call(registry, "getConfigurationElementsFor", new Class<?>[] { String.class }, point);
                for (Object element : elements) {
                    String className = (String) call(element, "getAttribute", new Class<?>[] { String.class }, "class");
                    if (className == null || !className.startsWith("org.example.dbeaver.echarts.")) continue;
                    // WorkbenchPart icon initialization needs a running workbench. Check
                    // the registered editor constructor here; exercise its page controller separately.
                    if (point.equals("org.eclipse.ui.editors")) {
                        Object instance = plugin.loadClass(className).getConstructor().newInstance();
                        editor |= instance.getClass().getName().endsWith("DashboardEditor");
                    }
                    // Navigator initialization requires the DBeaver application platform.
                    // Validate registration here; the running workbench owns activation.
                    handler |= className.endsWith("DashboardResourceHandler");
                }
            }
            if (!editor || !handler) throw new AssertionError("Dashboard editor or resource handler extension could not be instantiated");
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
