package org.example.dbeaver.echarts;

import org.eclipse.swt.layout.GridData;
import java.net.URI;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.eclipse.swt.SWT;
import org.eclipse.swt.browser.Browser;
import org.eclipse.swt.browser.BrowserFunction;
import org.eclipse.swt.browser.LocationAdapter;
import org.eclipse.swt.browser.LocationEvent;
import org.eclipse.swt.dnd.Transfer;
import org.eclipse.swt.layout.FillLayout;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.swt.widgets.Control;
import org.eclipse.swt.widgets.Label;
import org.jkiss.code.NotNull;
import org.jkiss.code.Nullable;
import org.jkiss.dbeaver.model.data.DBDAttributeBinding;
import org.jkiss.dbeaver.ui.controls.resultset.AbstractPresentation;
import org.jkiss.dbeaver.ui.controls.resultset.IResultSetController;
import org.jkiss.dbeaver.ui.controls.resultset.ResultSetCopySettings;

import java.net.URL;
import java.util.Collections;
import java.util.Map;

/**
 * Read-only ECharts presentation for the active DBeaver ResultSet.
 */
public final class EChartsPresentation extends AbstractPresentation {
    private Composite root;
    private Browser browser;
    private BrowserFunction datasetFunction;
    private DBeaverResultSetAdapter adapter;

    @Override
    public void createPresentation(@NotNull IResultSetController controller, @NotNull Composite parent) {
        super.createPresentation(controller, parent);
        adapter = new DBeaverResultSetAdapter(controller);

        root = new Composite(parent, SWT.NONE);
        root.setLayoutData(new GridData(SWT.FILL, SWT.FILL, true, true));
        root.setLayout(new FillLayout());

        try {
        	URL page = WebAssets.resolve("web/index.html");
        	String allowedPage = page.toExternalForm();

        	Path allowedRoot = Paths.get(page.toURI())
        	    .getParent()
        	    .toAbsolutePath()
        	    .normalize();

        	browser = new Browser(root, SWT.NONE);
        	browser.setJavascriptEnabled(true);

        	browser.addLocationListener(new LocationAdapter() {
        	    @Override
        	    public void changing(LocationEvent event) {
        	        String location = event.location;

        	        if (location == null
        	            || location.isBlank()
        	            || "about:blank".equalsIgnoreCase(location)) {
        	            return;
        	        }

        	        try {
        	            URI uri = URI.create(location);

        	            // BrowserFunction exposes Java to JavaScript.
        	            // Only permit local files belonging to this plugin.
        	            if (!"file".equalsIgnoreCase(uri.getScheme())) {
        	                event.doit = false;
        	                return;
        	            }

        	            Path requestedPath = Paths.get(uri)
        	                .toAbsolutePath()
        	                .normalize();

        	            if (!requestedPath.startsWith(allowedRoot)) {
        	                event.doit = false;
        	            }
        	        } catch (Exception e) {
        	            event.doit = false;
        	        }
        	    }
        	});

        	datasetFunction = new BrowserFunction(
        	    browser,
        	    "dbeaverGetDataset",
        	    true,
        	    new String[0]
        	) {
        	    @Override
        	    public Object function(Object[] arguments) {
        	        try {
        	            return adapter.snapshotAsJson();
        	        } catch (RuntimeException e) {
        	            return JsonWriter.write(Map.of(
        	                "schemaVersion", 1,
        	                "error", safeMessage(e)
        	            ));
        	        }
        	    }
        	};

        	boolean loadStarted = browser.setUrl(allowedPage);

        	if (!loadStarted) {
        	    throw new IllegalStateException(
        	        "SWT Browser refused to load: " + allowedPage
        	    );
        	}
        } catch (Throwable e) {
            if (browser != null && !browser.isDisposed()) {
                browser.dispose();
                browser = null;
            }
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
        reloadBrowserData();
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
        return Collections.emptyMap();
    }

    private void reloadBrowserData() {
        Browser currentBrowser = browser;
        if (currentBrowser == null || currentBrowser.isDisposed()) {
            return;
        }
        currentBrowser.getDisplay().asyncExec(() -> {
            if (!currentBrowser.isDisposed()) {
                currentBrowser.execute(
                    "if (window.DBeaverECharts) { window.DBeaverECharts.reload({preserveSelection:true}); }"
                );
            }
        });
    }

    @Override
    public void dispose() {
        if (datasetFunction != null && !datasetFunction.isDisposed()) {
            datasetFunction.dispose();
            datasetFunction = null;
        }
        browser = null;
        root = null;
        adapter = null;
        super.dispose();
    }

    private static String safeMessage(Throwable error) {
        String message = error.getMessage();
        return error.getClass().getSimpleName() + (message == null || message.isBlank() ? "" : ": " + message);
    }
}
