package org.example.dbeaver.echarts;

import org.eclipse.jface.util.IPropertyChangeListener;
import org.eclipse.swt.SWT;
import org.eclipse.swt.browser.Browser;
import org.eclipse.swt.browser.BrowserFunction;
import org.eclipse.swt.browser.LocationAdapter;
import org.eclipse.swt.browser.LocationEvent;
import org.eclipse.swt.browser.ProgressAdapter;
import org.eclipse.swt.browser.ProgressEvent;
import org.eclipse.swt.dnd.Transfer;
import org.eclipse.swt.graphics.Color;
import org.eclipse.swt.layout.FillLayout;
import org.eclipse.swt.layout.GridData;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.swt.widgets.Control;
import org.eclipse.swt.widgets.Display;
import org.eclipse.swt.widgets.FileDialog;
import org.eclipse.swt.widgets.Label;
import org.eclipse.ui.PlatformUI;
import org.eclipse.ui.themes.IThemeManager;
import org.jkiss.code.NotNull;
import org.jkiss.code.Nullable;
import org.jkiss.dbeaver.model.data.DBDAttributeBinding;
import org.jkiss.dbeaver.ui.controls.resultset.AbstractPresentation;
import org.jkiss.dbeaver.ui.controls.resultset.IResultSetController;
import org.jkiss.dbeaver.ui.controls.resultset.ResultSetCopySettings;

import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Read-only ECharts presentation for the active DBeaver ResultSet.
 */
public final class EChartsPresentation extends AbstractPresentation {
    private Composite root;
    private Browser browser;
    private Display display;
    private BrowserFunction datasetFunction;
    private BrowserFunction saveConfigurationFunction;
    private BrowserFunction browserReadyFunction;
    private BrowserFunction refreshResultFunction;
    private BrowserFunction importDashboardFunction;
    private BrowserFunction exportDashboardFunction;
    private BrowserFunction executeWidgetQueryFunction;
    private DBeaverResultSetAdapter adapter;
    private ChartConfigurationStore configurationStore;
    private EChartsSnapshotJob snapshotJob;
    private IThemeManager themeManager;
    private IPropertyChangeListener themeListener;
    private volatile String latestSnapshot;
    private long snapshotGeneration;
    private boolean browserReady;
    private final Map<String, DashboardQueryJob> widgetQueryJobs = new ConcurrentHashMap<>();
    private final Map<String, Long> widgetQueryGenerations = new ConcurrentHashMap<>();

    @Override
    public void createPresentation(@NotNull IResultSetController controller, @NotNull Composite parent) {
        super.createPresentation(controller, parent);
        display = parent.getDisplay();
        adapter = new DBeaverResultSetAdapter(controller);
        configurationStore = new ChartConfigurationStore(ChartConfigurationStore.sourceKey(controller));

        root = new Composite(parent, SWT.NONE);
        root.setLayoutData(new GridData(SWT.FILL, SWT.FILL, true, true));
        root.setLayout(new FillLayout());

        try {
            URL page = WebAssets.resolve("web/index.html");
            String allowedPage = page.toExternalForm();
            Path allowedRoot = Paths.get(page.toURI()).getParent().toAbsolutePath().normalize();

            browser = new Browser(root, SWT.NONE);
            browser.setJavascriptEnabled(true);
            browser.addLocationListener(new LocationAdapter() {
                @Override
                public void changing(LocationEvent event) {
                    String location = event.location;
                    if (location == null || location.isBlank() || "about:blank".equalsIgnoreCase(location)) {
                        return;
                    }
                    try {
                        URI uri = URI.create(location);
                        if (!"file".equalsIgnoreCase(uri.getScheme())) {
                            event.doit = false;
                            return;
                        }
                        Path requestedPath = Paths.get(uri).toAbsolutePath().normalize();
                        if (!requestedPath.startsWith(allowedRoot)) {
                            event.doit = false;
                        }
                    } catch (Exception e) {
                        event.doit = false;
                    }
                }
            });
            browser.addProgressListener(new ProgressAdapter() {
                @Override
                public void completed(ProgressEvent event) {
                    // The JavaScript ready handshake is authoritative. This is a
                    // compatibility fallback for SWT Browser implementations.
                    runOnUiThread(EChartsPresentation.this::requestBrowserReady);
                }
            });

            datasetFunction = new BrowserFunction(browser, "dbeaverGetDataset", true, new String[0]) {
                @Override
                public Object function(Object[] arguments) {
                    String snapshot = latestSnapshot;
                    return snapshot == null
                        ? JsonWriter.write(Map.of(
                            "schemaVersion", 1,
                            "error", "The result snapshot is still loading."
                        ))
                        : snapshot;
                }
            };
            saveConfigurationFunction = new BrowserFunction(
                browser,
                "dbeaverSaveConfiguration",
                true,
                new String[0]
            ) {
                @Override
                public Object function(Object[] arguments) {
                    if (arguments.length != 1 || !(arguments[0] instanceof String configuration)) {
                        return Boolean.FALSE;
                    }
                    configurationStore.save(configuration);
                    return Boolean.TRUE;
                }
            };
            browserReadyFunction = new BrowserFunction(browser, "dbeaverBrowserReady", true, new String[0]) {
                @Override
                public Object function(Object[] arguments) {
                    onBrowserReady();
                    return Boolean.TRUE;
                }
            };
            refreshResultFunction = new BrowserFunction(browser, "dbeaverRefreshResult", true, new String[0]) {
                @Override
                public Object function(Object[] arguments) {
                    controller.refresh();
                    return Boolean.TRUE;
                }
            };
            importDashboardFunction = new BrowserFunction(browser, "dbeaverImportDashboard", true, new String[0]) {
                @Override
                public Object function(Object[] arguments) {
                    return importDashboard();
                }
            };
            exportDashboardFunction = new BrowserFunction(browser, "dbeaverExportDashboard", true, new String[0]) {
                @Override
                public Object function(Object[] arguments) {
                    if (arguments.length != 1 || !(arguments[0] instanceof String dashboard)) {
                        return Boolean.FALSE;
                    }
                    return exportDashboard(dashboard);
                }
            };
            executeWidgetQueryFunction = new BrowserFunction(browser, "dbeaverExecuteWidgetQuery", true, new String[0]) {
                @Override
                public Object function(Object[] arguments) {
                    if (arguments.length != 2 || !(arguments[0] instanceof String widgetId) || !(arguments[1] instanceof String sql)) {
                        return Boolean.FALSE;
                    }
                    scheduleWidgetQuery(widgetId, sql);
                    return Boolean.TRUE;
                }
            };

            registerThemeListener();
            if (!browser.setUrl(allowedPage)) {
                throw new IllegalStateException("SWT Browser refused to load: " + allowedPage);
            }
        } catch (Throwable e) {
            if (browser != null && !browser.isDisposed()) {
                browser.dispose();
                browser = null;
            }
            root.setLayout(new FillLayout());
            Label fallback = new Label(root, SWT.WRAP);
            fallback.setText("ECharts presentation could not start.\n\n" + safeMessage(e));
        }
    }

    @Nullable
    @Override
    public Control getControl() {
        return root;
    }

    @Override
    public void refreshData(boolean refreshMetadata, boolean append, boolean keepState) {
        reloadBrowserData();
    }

    @Override
    public void formatData(boolean refreshData) {
        if (refreshData) {
            reloadBrowserData();
        }
    }

    @Override
    public void clearMetaData() {
        prepareForReload();
    }

    @Override
    public void updateValueView() {
        // Read-only presentation: editing is intentionally delegated to Grid/Text.
    }

    @Override
    public void changeMode(boolean recordMode) {
        reloadBrowserData();
    }

    @Nullable
    @Override
    public DBDAttributeBinding getCurrentAttribute() {
        return null;
    }

    @NotNull
    @Override
    public Map<Transfer, Object> copySelection(@NotNull ResultSetCopySettings settings) {
        return adapter == null ? Map.of() : adapter.copySelection(settings);
    }

    private void reloadBrowserData() {
        runOnUiThread(this::reloadBrowserDataOnUiThread);
    }

    private void reloadBrowserDataOnUiThread() {
        adapter = new DBeaverResultSetAdapter(controller);
        configurationStore = new ChartConfigurationStore(ChartConfigurationStore.sourceKey(controller));
        publishConfiguration();
        if (browserReady) {
            executeBrowser("if (window.DBeaverECharts) { window.DBeaverECharts.setLoading(); }");
        }
        scheduleSnapshot();
    }

    private void onBrowserReady() {
        runOnUiThread(this::onBrowserReadyOnUiThread);
    }

    private void onBrowserReadyOnUiThread() {
        if (browserReady) {
            return;
        }
        browserReady = true;
        publishConfiguration();
        publishTheme();
        scheduleSnapshot();
    }

    private void requestBrowserReady() {
        executeBrowser(
            "if (typeof window.dbeaverBrowserReady === 'function') {" +
                "if (document.readyState === 'loading') {" +
                    "document.addEventListener('DOMContentLoaded', function() { window.dbeaverBrowserReady(); }, false);" +
                "} else { window.dbeaverBrowserReady(); }" +
            "}"
        );
    }

    private void scheduleSnapshot() {
        runOnUiThread(this::scheduleSnapshotOnUiThread);
    }

    private void scheduleSnapshotOnUiThread() {
        DBeaverResultSetAdapter currentAdapter = adapter;
        if (currentAdapter == null) {
            return;
        }
        if (snapshotJob != null) {
            snapshotJob.cancel();
        }
        long generation = ++snapshotGeneration;
        snapshotJob = new EChartsSnapshotJob(
            currentAdapter,
            snapshot -> publishSnapshot(generation, snapshot),
            error -> publishError(generation, error)
        );
        snapshotJob.schedule();
    }

    private void publishSnapshot(long generation, String snapshot) {
        runOnUiThread(() -> {
            if (generation != snapshotGeneration) {
                return;
            }
            latestSnapshot = snapshot;
            executeBrowser("if (window.DBeaverECharts) { window.DBeaverECharts.setSnapshot(" + snapshot + "); }");
        });
    }

    private void publishError(long generation, RuntimeException error) {
        runOnUiThread(() -> {
            if (generation != snapshotGeneration) {
                return;
            }
            executeBrowser(
                "if (window.DBeaverECharts) { window.DBeaverECharts.setError(" +
                    JsonWriter.write(safeMessage(error)) + "); }"
            );
        });
    }

    private void publishConfiguration() {
        runOnUiThread(this::publishConfigurationOnUiThread);
    }

    private void publishConfigurationOnUiThread() {
        String configuration = configurationStore == null ? null : configurationStore.load();
        String operation = configuration == null
            ? "clearConfiguration()"
            : "setConfigurationJson(" + JsonWriter.write(configuration) + ")";
        executeBrowser("if (window.DBeaverECharts) { window.DBeaverECharts." + operation + "; }");
    }

    private void registerThemeListener() {
        try {
            themeManager = PlatformUI.getWorkbench().getThemeManager();
            themeListener = event -> publishTheme();
            themeManager.addPropertyChangeListener(themeListener);
        } catch (RuntimeException ignored) {
            // The presentation still uses the browser's color-scheme fallback.
        }
    }

    private void publishTheme() {
        runOnUiThread(this::publishThemeOnUiThread);
    }

    private void publishThemeOnUiThread() {
        if (!browserReady) {
            return;
        }
        Color background = controller.getDefaultBackground();
        Color foreground = controller.getDefaultForeground();
        String backgroundColor = rgb(background);
        String foregroundColor = rgb(foreground);
        double luminance = (background.getRed() * 0.299 + background.getGreen() * 0.587 + background.getBlue() * 0.114) / 255.0;
        Map<String, Object> theme = new LinkedHashMap<>();
        theme.put("background", backgroundColor);
        theme.put("foreground", foregroundColor);
        theme.put("muted", mix(background, foreground, 0.58));
        theme.put("border", mix(background, foreground, 0.24));
        theme.put("grid", mix(background, foreground, 0.18));
        theme.put("controlBackground", mix(background, foreground, 0.05));
        theme.put("dark", luminance < 0.5);
        executeBrowser("if (window.DBeaverECharts) { window.DBeaverECharts.setTheme(" + JsonWriter.write(theme) + "); }");
    }

    private void executeBrowser(String script) {
        runOnUiThread(() -> {
            Browser currentBrowser = browser;
            if (currentBrowser != null && !currentBrowser.isDisposed()) {
                currentBrowser.execute(script);
            }
        });
    }

    private void prepareForReload() {
        runOnUiThread(() -> {
            snapshotGeneration++;
            latestSnapshot = null;
            if (snapshotJob != null) {
                snapshotJob.cancel();
                snapshotJob = null;
            }
            if (browserReady) {
                executeBrowser("if (window.DBeaverECharts) { window.DBeaverECharts.setLoading(); }");
            }
        });
    }

    private void runOnUiThread(Runnable action) {
        Display currentDisplay = display;
        if (currentDisplay == null || currentDisplay.isDisposed()) {
            return;
        }
        if (currentDisplay.getThread() == Thread.currentThread()) {
            if (isBrowserAvailable()) {
                action.run();
            }
            return;
        }
        currentDisplay.asyncExec(() -> {
            if (isBrowserAvailable()) {
                action.run();
            }
        });
    }

    private boolean isBrowserAvailable() {
        return browser != null && !browser.isDisposed();
    }

    private String importDashboard() {
        Browser currentBrowser = browser;
        if (currentBrowser == null || currentBrowser.isDisposed()) {
            return null;
        }
        FileDialog dialog = new FileDialog(currentBrowser.getShell(), SWT.OPEN);
        dialog.setText("Import ECharts dashboard");
        dialog.setFilterExtensions(new String[] {"*.echarts-dashboard.json", "*.json", "*.*"});
        String selected = dialog.open();
        if (selected == null) {
            return null;
        }
        try {
            String dashboard = Files.readString(Path.of(selected), StandardCharsets.UTF_8);
            return dashboard.length() <= 1_048_576 ? dashboard : null;
        } catch (Exception e) {
            return null;
        }
    }

    private Boolean exportDashboard(String dashboard) {
        Browser currentBrowser = browser;
        if (currentBrowser == null || currentBrowser.isDisposed() || dashboard.length() > 1_048_576) {
            return Boolean.FALSE;
        }
        FileDialog dialog = new FileDialog(currentBrowser.getShell(), SWT.SAVE);
        dialog.setText("Export ECharts dashboard");
        dialog.setFileName("dashboard.echarts-dashboard.json");
        dialog.setFilterExtensions(new String[] {"*.echarts-dashboard.json", "*.json"});
        dialog.setOverwrite(true);
        String selected = dialog.open();
        if (selected == null) {
            return Boolean.FALSE;
        }
        try {
            Files.writeString(Path.of(selected), dashboard, StandardCharsets.UTF_8);
            return Boolean.TRUE;
        } catch (Exception e) {
            return Boolean.FALSE;
        }
    }

    private void scheduleWidgetQuery(String widgetId, String sql) {
        DashboardQueryJob previous = widgetQueryJobs.remove(widgetId);
        if (previous != null) {
            previous.cancel();
        }
        long generation = widgetQueryGenerations.merge(widgetId, 1L, Long::sum);
        DashboardQueryJob job = new DashboardQueryJob(
            controller.getExecutionContext(),
            sql,
            EChartsPreferences.getMaxRows(),
            EChartsPreferences.getMaxCells(),
            snapshot -> publishWidgetSnapshot(widgetId, generation, snapshot),
            error -> publishWidgetError(widgetId, generation, error)
        );
        widgetQueryJobs.put(widgetId, job);
        job.schedule();
    }

    private void publishWidgetSnapshot(String widgetId, long generation, String snapshot) {
        runOnUiThread(() -> {
            if (widgetQueryGenerations.getOrDefault(widgetId, 0L) != generation) {
                return;
            }
            widgetQueryJobs.remove(widgetId);
            executeBrowser(
                "if (window.DBeaverECharts) { window.DBeaverECharts.setWidgetSnapshot(" +
                    JsonWriter.write(widgetId) + "," + snapshot + "); }"
            );
        });
    }

    private void publishWidgetError(String widgetId, long generation, Exception error) {
        runOnUiThread(() -> {
            if (widgetQueryGenerations.getOrDefault(widgetId, 0L) != generation) {
                return;
            }
            widgetQueryJobs.remove(widgetId);
            executeBrowser(
                "if (window.DBeaverECharts) { window.DBeaverECharts.setWidgetError(" +
                    JsonWriter.write(widgetId) + "," + JsonWriter.write(safeMessage(error)) + "); }"
            );
        });
    }

    private static String rgb(Color color) {
        return String.format(Locale.ROOT, "#%02x%02x%02x", color.getRed(), color.getGreen(), color.getBlue());
    }

    private static String mix(Color background, Color foreground, double foregroundWeight) {
        double backgroundWeight = 1.0 - foregroundWeight;
        int red = (int) Math.round(background.getRed() * backgroundWeight + foreground.getRed() * foregroundWeight);
        int green = (int) Math.round(background.getGreen() * backgroundWeight + foreground.getGreen() * foregroundWeight);
        int blue = (int) Math.round(background.getBlue() * backgroundWeight + foreground.getBlue() * foregroundWeight);
        return String.format(Locale.ROOT, "#%02x%02x%02x", red, green, blue);
    }

    @Override
    public void dispose() {
        snapshotGeneration++;
        if (snapshotJob != null) {
            snapshotJob.cancel();
            snapshotJob = null;
        }
        if (themeManager != null && themeListener != null) {
            themeManager.removePropertyChangeListener(themeListener);
        }
        if (saveConfigurationFunction != null && !saveConfigurationFunction.isDisposed()) {
            saveConfigurationFunction.dispose();
        }
        if (browserReadyFunction != null && !browserReadyFunction.isDisposed()) {
            browserReadyFunction.dispose();
        }
        if (refreshResultFunction != null && !refreshResultFunction.isDisposed()) {
            refreshResultFunction.dispose();
        }
        if (importDashboardFunction != null && !importDashboardFunction.isDisposed()) {
            importDashboardFunction.dispose();
        }
        if (exportDashboardFunction != null && !exportDashboardFunction.isDisposed()) {
            exportDashboardFunction.dispose();
        }
        if (executeWidgetQueryFunction != null && !executeWidgetQueryFunction.isDisposed()) {
            executeWidgetQueryFunction.dispose();
        }
        for (DashboardQueryJob job : widgetQueryJobs.values()) {
            job.cancel();
        }
        widgetQueryJobs.clear();
        widgetQueryGenerations.clear();
        if (datasetFunction != null && !datasetFunction.isDisposed()) {
            datasetFunction.dispose();
        }
        browser = null;
        display = null;
        root = null;
        adapter = null;
        configurationStore = null;
        super.dispose();
    }

    private static String safeMessage(Throwable error) {
        String message = error.getMessage();
        return error.getClass().getSimpleName() + (message == null || message.isBlank() ? "" : ": " + message);
    }
}
