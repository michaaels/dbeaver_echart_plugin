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
import org.eclipse.ui.ide.IDE;
import org.eclipse.jface.dialogs.MessageDialog;
import org.eclipse.ui.themes.IThemeManager;
import org.jkiss.code.NotNull;
import org.jkiss.code.Nullable;
import org.jkiss.dbeaver.model.data.DBDAttributeBinding;
import org.jkiss.dbeaver.model.app.DBPProject;
import org.jkiss.dbeaver.runtime.DBWorkbench;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Base64;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.function.Function;

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
    private BrowserFunction approveWidgetQueriesFunction;
    private BrowserFunction cancelWidgetQueryFunction;
    private BrowserFunction resetDashboardQueriesFunction;
    private final DashboardQueryApproval queryApproval = new DashboardQueryApproval();
    private BrowserFunction saveDashboardFunction;
    private BrowserFunction openDashboardFunction;
    private BrowserFunction listConnectionsFunction;
    private BrowserFunction dashboardChangedFunction;
    private DBeaverResultSetAdapter adapter;
    private ChartConfigurationStore configurationStore;
    private EChartsSnapshotJob snapshotJob;
    private IThemeManager themeManager;
    private IPropertyChangeListener themeListener;
    private volatile String latestSnapshot;
    private long snapshotGeneration;
    private boolean browserReady;
    private String standaloneDocument;
    private DBPProject dashboardProject;
    private Consumer<String> configurationChanged;
    private Function<String, String> saveDocument;
    private Runnable markDirty;
    private boolean reportMode;
    private boolean reportLoadingAsNew;
    private Path reportFile;
    private String reportDiskText;
    private Runnable reportSaved;
    private final List<BrowserFunction> reportFunctions = new ArrayList<>();
    private final Map<String, DashboardQueryJob> widgetQueryJobs = new ConcurrentHashMap<>();
    private final Map<String, Long> widgetQueryGenerations = new ConcurrentHashMap<>();

    @Override
    public void createPresentation(@NotNull IResultSetController controller, @NotNull Composite parent) {
        super.createPresentation(controller, parent);
        display = parent.getDisplay();
        adapter = new DBeaverResultSetAdapter(controller);
        configurationStore = new ChartConfigurationStore(ChartConfigurationStore.sourceKey(controller));
        dashboardProject = controller.getExecutionContext() == null ? null
            : controller.getExecutionContext().getDataSource().getContainer().getProject();
        createBrowser(parent);
    }

    void createStandalone(Composite parent, String document, DBPProject project,
                          Consumer<String> onChange, Function<String, String> onSave, Runnable onDirty) {
        standaloneDocument = document;
        dashboardProject = project;
        configurationChanged = onChange;
        saveDocument = onSave;
        markDirty = onDirty;
        createBrowser(parent);
    }

    void createReport(Composite parent, String document, DBPProject project,
                      Consumer<String> onChange, Function<String, String> onSave, Runnable onDirty) {
        reportMode = true;
        createStandalone(parent, document, project, onChange, onSave, onDirty);
    }

    void loadReport(String document) {
        standaloneDocument = ReportFiles.canonical(document);
        reportFile = null;
        reportDiskText = null;
        reportLoadingAsNew = true;
        if (browserReady) executeBrowser("window.DBeaverECharts.loadReport(JSON.parse(" + JsonWriter.write(standaloneDocument) + "),true);" );
    }

    void setReportSavedListener(Runnable listener) { reportSaved = listener; }

    String currentReportDocument() {
        if (!isBrowserAvailable() || !browserReady) throw new IllegalStateException("The report designer is still loading.");
        Object value = browser.evaluate("return JSON.stringify(window.DBeaverECharts.reportDocument());");
        if (!(value instanceof String document)) throw new IllegalStateException("Cannot read the report template.");
        return ReportFiles.canonical(document);
    }

    String saveCurrentReport(boolean saveAs) { return saveReport(currentReportDocument(), saveAs); }
    void markReportSaved() { executeBrowser("window.DBeaverECharts.markReportSaved();"); }

    private void createBrowser(Composite parent) {
        display = parent.getDisplay();

        root = new Composite(parent, SWT.NONE);
        root.setLayoutData(new GridData(SWT.FILL, SWT.FILL, true, true));
        root.setLayout(new FillLayout());

        try {
            URL page = WebAssets.resolve(reportMode ? "web/report.html" : "web/index.html");
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
                    if (configurationChanged != null) configurationChanged.accept(configuration);
                    else configurationStore.save(configuration);
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
                    if (controller != null) controller.refresh();
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
                    if (arguments.length != 3 || !(arguments[0] instanceof String widgetId)
                        || !(arguments[1] instanceof String sql) || !(arguments[2] instanceof String source)) {
                        return Boolean.FALSE;
                    }
                    try { return scheduleWidgetQuery(widgetId, sql, source); }
                    catch (RuntimeException invalid) { return Boolean.FALSE; }
                }
            };
            approveWidgetQueriesFunction = new BrowserFunction(browser, "dbeaverApproveWidgetQueries", true, new String[0]) {
                @Override
                public Object function(Object[] arguments) {
                    return arguments.length == 1 && arguments[0] instanceof String json && queryApproval.approve(json);
                }
            };
            cancelWidgetQueryFunction = new BrowserFunction(browser, "dbeaverCancelWidgetQuery", true, new String[0]) {
                @Override
                public Object function(Object[] arguments) {
                    if (arguments.length < 1 || arguments.length > 2 || !(arguments[0] instanceof String id)) return Boolean.FALSE;
                    if (arguments.length == 2 && Boolean.TRUE.equals(arguments[1])) queryApproval.revoke(id);
                    cancelWidgetQuery(id);
                    return Boolean.TRUE;
                }
            };
            resetDashboardQueriesFunction = new BrowserFunction(browser, "dbeaverResetDashboardQueries", true, new String[0]) {
                @Override
                public Object function(Object[] arguments) {
                    for (String id : widgetQueryJobs.keySet()) cancelWidgetQuery(id);
                    queryApproval.clear();
                    return Boolean.TRUE;
                }
            };
            saveDashboardFunction = new BrowserFunction(browser, "dbeaverSaveDashboard", true, new String[0]) {
                @Override
                public Object function(Object[] arguments) {
                    return arguments.length == 1 && arguments[0] instanceof String document ? saveDashboard(document) : null;
                }
            };
            openDashboardFunction = new BrowserFunction(browser, "dbeaverOpenDashboard", true, new String[0]) {
                @Override
                public Object function(Object[] arguments) { return openDashboard(); }
            };
            listConnectionsFunction = new BrowserFunction(browser, "dbeaverListConnections", true, new String[0]) {
                @Override
                public Object function(Object[] arguments) { return DashboardConnections.list(); }
            };
            dashboardChangedFunction = new BrowserFunction(browser, "dbeaverDashboardChanged", true, new String[0]) {
                @Override
                public Object function(Object[] arguments) {
                    if (markDirty != null) markDirty.run();
                    return Boolean.TRUE;
                }
            };

            registerReportFunctions();
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
        // Refresh rows without replacing the in-memory dashboard or its query snapshots.
        // File persistence handles dashboards independently of result-tab preferences.
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
        if (standaloneDocument != null) {
            executeBrowser("window.DBeaverECharts." + (reportMode ? "loadReport" : "loadDashboard") + "(JSON.parse(" + JsonWriter.write(standaloneDocument) + ")," + (!reportMode || reportLoadingAsNew) + ");");
        } else { publishConfiguration(); }
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
        Color background = controller == null ? root.getBackground() : controller.getDefaultBackground();
        Color foreground = controller == null ? root.getForeground() : controller.getDefaultForeground();
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
        setDashboardFolder(dialog);
        String selected = dialog.open();
        if (selected == null) {
            return null;
        }
        try {
            return DashboardFiles.read(Path.of(selected));
        } catch (Exception e) {
            showDashboardError(e);
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
            DashboardFiles.write(Path.of(selected), dashboard);
            return Boolean.TRUE;
        } catch (Exception e) {
            showDashboardError(e);
            return Boolean.FALSE;
        }
    }

    private String saveDashboard(String document) {
        if (saveDocument != null) return saveDocument.apply(document);
        try {
            JsonObject dashboard = DashboardFiles.parse(document);
            Path folder = dashboardFolder();
            Files.createDirectories(folder);
            FileDialog dialog = new FileDialog(browser.getShell(), SWT.SAVE);
            dialog.setText("Save ECharts dashboard (JSON and SQL)");
            dialog.setFilterPath(folder.toString());
            String name = DashboardFiles.string(dashboard, "title").replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_")
                .replaceAll("[ .]+$", "");
            if (name.isBlank()) name = "dashboard";
            dialog.setFileName(name + DashboardFiles.SUFFIX);
            dialog.setFilterExtensions(new String[] {"*.echarts-dashboard.json"});
            dialog.setOverwrite(true);
            String selected = dialog.open();
            if (selected == null) return null;
            Path file = Path.of(selected);
            DashboardFiles.write(file, document);
            if (dashboardProject != null) dashboardProject.refreshProject();
            return file.toString();
        } catch (Exception e) { showDashboardError(e); return null; }
    }

    private Path dashboardFolder() {
        DBPProject project = dashboardProject != null ? dashboardProject
            : DBWorkbench.getPlatform().getWorkspace().getActiveProject();
        if (project == null) throw new IllegalStateException("Open a DBeaver project first.");
        return project.getAbsolutePath().resolve("Dashboards").resolve("ECharts");
    }

    private void setDashboardFolder(FileDialog dialog) {
        try { dialog.setFilterPath(dashboardFolder().toString()); } catch (RuntimeException ignored) { }
    }

    private Boolean openDashboard() {
        FileDialog dialog = new FileDialog(browser.getShell(), SWT.OPEN);
        dialog.setText("Open ECharts dashboard");
        dialog.setFilterExtensions(new String[] {"*.echarts-dashboard.json", "*.json"});
        setDashboardFolder(dialog);
        String selected = dialog.open();
        if (selected == null) return Boolean.FALSE;
        try {
            Path file = Path.of(selected);
            DashboardFiles.read(file);
            IDE.openEditor(PlatformUI.getWorkbench().getActiveWorkbenchWindow().getActivePage(),
                file.toUri(), DashboardEditor.ID, true);
            return Boolean.TRUE;
        } catch (Exception e) { showDashboardError(e); return Boolean.FALSE; }
    }

    private void showDashboardError(Exception error) {
        MessageDialog.openError(browser.getShell(), "ECharts dashboard", safeMessage(error));
    }

    String currentDashboardDocument() {
        if (!isBrowserAvailable() || !browserReady) throw new IllegalStateException("The dashboard is still loading.");
        Object value = browser.evaluate("return JSON.stringify(window.DBeaverECharts.dashboardDocument());");
        if (!(value instanceof String document)) throw new IllegalStateException("The dashboard could not be read.");
        return document;
    }

    private void cancelWidgetQuery(String widgetId) {
        DashboardQueryJob previous = widgetQueryJobs.remove(widgetId);
        if (previous != null) previous.requestCancellation();
        widgetQueryGenerations.merge(widgetId, 1L, Long::sum);
    }

    private boolean scheduleWidgetQuery(String widgetId, String sql, String sourceJson) {
        if (sourceJson.length() > 1_048_576 || sql.length() > 1_000_000 || widgetId.length() > 200) return false;
        JsonObject source = JsonParser.parseString(sourceJson).getAsJsonObject();
        if (!queryApproval.accepts(widgetId, sql, source)) return false;
        ReportParameters.Plan plan = ReportParameters.prepare(sql, source.has("parameters") ? source.getAsJsonObject("parameters") : null);
        int maxRows = EChartsPreferences.getMaxRows();
        if (reportMode && source.has("maxRows") && source.get("maxRows").getAsInt() > 0) maxRows = Math.min(maxRows, source.get("maxRows").getAsInt());
        cancelWidgetQuery(widgetId);
        long generation = widgetQueryGenerations.merge(widgetId, 1L, Long::sum);
        DashboardQueryJob job = new DashboardQueryJob(
            () -> DashboardConnections.resolve(source, dashboardProject),
            plan.sql(),
            maxRows,
            EChartsPreferences.getMaxCells(),
            EChartsPreferences.getQueryTimeoutSeconds(),
            snapshot -> publishWidgetSnapshot(widgetId, generation, snapshot),
            error -> publishWidgetError(widgetId, generation, error),
            plan.bindings()
        );
        widgetQueryJobs.put(widgetId, job);
        job.schedule();
        return true;
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

    private void reportFunction(String name, Function<Object[], Object> action) {
        reportFunctions.add(new BrowserFunction(browser, name, true, new String[0]) {
            @Override public Object function(Object[] arguments) {
                try { return action.apply(arguments); }
                catch (Exception error) { showDashboardError(error); return null; }
            }
        });
    }

    private void registerReportFunctions() {
        reportFunction("dbeaverOpenReportDesigner", arguments -> {
            if (arguments.length != 1 || !(arguments[0] instanceof String document)) return false;
            try {
                String report = ReportFiles.fromDashboard(document);
                var view = (ReportDesignerView) PlatformUI.getWorkbench().getActiveWorkbenchWindow().getActivePage().showView(ReportDesignerView.ID);
                return view.load(report);
            } catch (Exception error) { throw new IllegalStateException(error); }
        });
        if (!reportMode) return;
        reportFunction("dbeaverNewReport", arguments -> {
            if (arguments.length != 1 || !(arguments[0] instanceof String document)) return false;
            try {
                String report = ReportFiles.canonical(document);
                var view = (ReportDesignerView) PlatformUI.getWorkbench().getActiveWorkbenchWindow().getActivePage().showView(ReportDesignerView.ID);
                return view.load(report);
            } catch (Exception error) { throw new IllegalStateException(error); }
        });
        reportFunction("dbeaverSaveReport", arguments -> arguments.length >= 1 && arguments[0] instanceof String document
            ? saveReport(document, arguments.length > 1 && Boolean.TRUE.equals(arguments[1])) : null);
        reportFunction("dbeaverImportReport", arguments -> {
            FileDialog dialog = reportDialog(SWT.OPEN, "Import report template", "*.echarts-report.json");
            String selected = dialog.open();
            if (selected == null) return null;
            try { return ReportFiles.read(Path.of(selected)); }
            catch (Exception error) { throw new IllegalStateException(error); }
        });
        reportFunction("dbeaverOpenReport", arguments -> {
            FileDialog dialog = reportDialog(SWT.OPEN, "Open report template", "*.echarts-report.json");
            String selected = dialog.open();
            if (selected == null) return false;
            try {
                Path file = Path.of(selected); ReportFiles.read(file);
                IDE.openEditor(PlatformUI.getWorkbench().getActiveWorkbenchWindow().getActivePage(), file.toUri(), ReportEditor.ID, true);
                return true;
            } catch (Exception error) { throw new IllegalStateException(error); }
        });
        reportFunction("dbeaverListReportTemplates", arguments -> {
            List<Map<String, Object>> templates = new ArrayList<>();
            Path folder = reportFolder();
            if (Files.isDirectory(folder)) {
                try (var files = Files.walk(folder, 3)) {
                    for (Path file : files.filter(path -> Files.isRegularFile(path) && path.getFileName().toString().endsWith(ReportFiles.SUFFIX)).limit(500).toList()) {
                        try {
                            JsonObject report = ReportFiles.parse(ReportFiles.read(file));
                            templates.add(Map.of("path", folder.relativize(file).toString(), "title", DashboardFiles.string(report, "title"),
                                "category", DashboardFiles.string(report, "category"), "description", DashboardFiles.string(report, "description")));
                        } catch (Exception ignored) { /* Invalid templates stay visible in DBeaver's Files navigator. */ }
                    }
                } catch (Exception error) { throw new IllegalStateException(error); }
            }
            return JsonWriter.write(templates);
        });
        reportFunction("dbeaverLoadReportTemplate", arguments -> {
            if (arguments.length != 1 || !(arguments[0] instanceof String relative)) return null;
            Path folder = reportFolder().toAbsolutePath().normalize(), target = folder.resolve(relative).normalize();
            if (!target.startsWith(folder) || !target.getFileName().toString().endsWith(ReportFiles.SUFFIX)) return null;
            try { return ReportFiles.read(target); } catch (Exception error) { throw new IllegalStateException(error); }
        });
        reportFunction("dbeaverReportPickImage", arguments -> {
            FileDialog dialog = new FileDialog(browser.getShell(), SWT.OPEN);
            dialog.setText("Choose local report image (up to 2 MiB)"); dialog.setFilterExtensions(new String[] {"*.png;*.jpg;*.jpeg;*.gif;*.webp"});
            String selected = dialog.open(); if (selected == null) return null;
            try {
                Path file = Path.of(selected);
                if (Files.size(file) > 2_097_152) throw new IllegalArgumentException("Image exceeds 2 MiB.");
                String extension = file.getFileName().toString().replaceFirst("^.*\\.", "").toLowerCase(Locale.ROOT);
                String type = switch (extension) { case "png", "gif", "webp" -> extension; case "jpg", "jpeg" -> "jpeg"; default -> throw new IllegalArgumentException("Unsupported image."); };
                return "data:image/" + type + ";base64," + Base64.getEncoder().encodeToString(Files.readAllBytes(file));
            } catch (Exception error) { throw new IllegalStateException(error); }
        });
        reportFunction("dbeaverReportExportAssets", arguments -> {
            Map<String, String> assets = new LinkedHashMap<>();
            for (var entry : Map.of("echarts", "web/js/echarts.min.js", "worldMap", "web/js/world-map.js", "analytics", "web/js/analytics.js",
                    "widgets", "web/js/report-widgets.js", "paperCss", "web/css/report-paper.css").entrySet()) {
                assets.put(entry.getKey(), assetText(entry.getValue()));
            }
            assets.put("licenses", assetText("third-party/echarts/LICENSE") + "\n" + assetText("third-party/echarts/NOTICE")
                + "\n" + assetText("third-party/echarts/licenses/LICENSE-d3") + "\n" + assetText("third-party/world-map/LICENSE"));
            return JsonWriter.write(assets);
        });
        reportFunction("dbeaverExportReport", arguments -> {
            if (arguments.length < 3 || !(arguments[0] instanceof String content) || !(arguments[1] instanceof String kind)
                || !(arguments[2] instanceof String title) || !Set.of("interactive", "email", "template", "eml").contains(kind)) return null;
            if (content.getBytes(StandardCharsets.UTF_8).length > ReportFiles.MAX_EXPORT_BYTES) throw new IllegalArgumentException("Generated report exceeds 32 MiB.");
            String extension = "template".equals(kind) ? ".echarts-report.json" : "eml".equals(kind) ? ".eml" : ".html";
            FileDialog dialog = reportDialog(SWT.SAVE, "eml".equals(kind) ? "Save email draft (not sent)" : "Export report", "*" + extension);
            dialog.setFileName(fileName(title) + extension); dialog.setOverwrite(true);
            String selected = dialog.open(); if (selected == null) return null;
            try {
                Path file = Path.of(selected);
                if ("template".equals(kind)) ReportFiles.write(file, content); else ReportFiles.export(file, content);
                boolean opened = "eml".equals(kind) && arguments.length > 3 && Boolean.TRUE.equals(arguments[3])
                    && org.eclipse.swt.program.Program.launch(file.toString());
                return JsonWriter.write(Map.of("path", file.toString(), "opened", opened, "sent", false));
            } catch (Exception error) { throw new IllegalStateException(error); }
        });
    }

    private static String assetText(String name) {
        try { return Files.readString(Path.of(WebAssets.resolve(name).toURI()), StandardCharsets.UTF_8); }
        catch (Exception error) { throw new IllegalStateException("Cannot read bundled report asset: " + name, error); }
    }
    private Path reportFolder() {
        DBPProject project = dashboardProject != null ? dashboardProject : DBWorkbench.getPlatform().getWorkspace().getActiveProject();
        if (project == null) throw new IllegalStateException("Open a DBeaver project first.");
        return project.getAbsolutePath().resolve("Reports").resolve("ECharts");
    }
    private FileDialog reportDialog(int style, String title, String extension) {
        FileDialog dialog = new FileDialog(browser.getShell(), style);
        dialog.setText(title); dialog.setFilterExtensions(new String[] {extension});
        try { dialog.setFilterPath(reportFolder().toString()); } catch (RuntimeException ignored) { }
        return dialog;
    }
    private static String fileName(String title) {
        String name = title.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").replaceAll("[ .]+$", "");
        return name.isBlank() ? "report" : name.substring(0, Math.min(name.length(), 120));
    }
    private String saveReport(String document, boolean saveAs) {
        try {
            JsonObject report = ReportFiles.parse(document);
            if (saveDocument != null && !saveAs) return saveDocument.apply(document);
            Path file = reportFile;
            if (file == null || saveAs) {
                Path folder = reportFolder(); Files.createDirectories(folder);
                FileDialog dialog = reportDialog(SWT.SAVE, "Save report template (JSON and SQL)", "*.echarts-report.json");
                dialog.setFileName(fileName(DashboardFiles.string(report, "title")) + ReportFiles.SUFFIX); dialog.setOverwrite(true);
                String selected = dialog.open(); if (selected == null) return null;
                file = Path.of(selected);
            } else if (!Files.exists(file) || !Files.readString(file, StandardCharsets.UTF_8).equals(reportDiskText)) {
                throw new IllegalStateException("The report changed on disk. Reopen it before saving.");
            }
            ReportFiles.write(file, document); reportFile = file; reportDiskText = Files.readString(file, StandardCharsets.UTF_8);
            ReportFiles.updateDefault(reportFolder(), file, report.has("defaultTemplate") && report.get("defaultTemplate").getAsBoolean());
            if (dashboardProject != null) dashboardProject.refreshProject();
            if (reportSaved != null) reportSaved.run();
            return file.toString();
        } catch (Exception error) { showDashboardError(error); return null; }
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
        for (BrowserFunction function : reportFunctions) if (!function.isDisposed()) function.dispose();
        reportFunctions.clear();
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
        for (BrowserFunction function : new BrowserFunction[] {saveDashboardFunction, openDashboardFunction,
                listConnectionsFunction, dashboardChangedFunction, approveWidgetQueriesFunction,
                cancelWidgetQueryFunction, resetDashboardQueriesFunction}) {
            if (function != null && !function.isDisposed()) function.dispose();
        }
        for (DashboardQueryJob job : widgetQueryJobs.values()) {
            job.requestCancellation();
        }
        widgetQueryJobs.clear();
        widgetQueryGenerations.clear();
        queryApproval.clear();
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
