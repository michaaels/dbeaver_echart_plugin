package org.example.dbeaver.echarts;

import org.eclipse.core.runtime.preferences.InstanceScope;
import org.eclipse.jface.preference.IPreferenceStore;
import org.osgi.service.prefs.Preferences;

/**
 * Centralizes user-configurable limits and defaults for the ECharts presentation.
 */
final class EChartsPreferences {
    static final String PLUGIN_ID = "org.example.dbeaver.echarts";
    static final String MAX_ROWS = "maxRows";
    static final String MAX_CELLS = "maxCells";
    static final String DEFAULT_RENDERER = "defaultRenderer";
    static final String QUERY_TIMEOUT_SECONDS = "queryTimeoutSeconds";
    static final int DEFAULT_QUERY_TIMEOUT_SECONDS = 30;

    static final int DEFAULT_MAX_ROWS = 50_000;
    static final int DEFAULT_MAX_CELLS = 1_000_000;
    static final int MIN_MAX_ROWS = 1;
    static final int MAX_MAX_ROWS = 1_000_000;
    static final int MIN_MAX_CELLS = 1;
    static final int MAX_MAX_CELLS = 10_000_000;
    static final String RENDERER_CANVAS = "canvas";
    static final String RENDERER_SVG = "svg";

    private EChartsPreferences() {
    }

    static Preferences node() {
        return InstanceScope.INSTANCE.getNode(PLUGIN_ID);
    }

    static int getMaxRows() {
        return bounded(node().getInt(MAX_ROWS, DEFAULT_MAX_ROWS), MIN_MAX_ROWS, MAX_MAX_ROWS);
    }

    static int getMaxCells() {
        return bounded(node().getInt(MAX_CELLS, DEFAULT_MAX_CELLS), MIN_MAX_CELLS, MAX_MAX_CELLS);
    }

    static String getDefaultRenderer() {
        String renderer = node().get(DEFAULT_RENDERER, RENDERER_CANVAS);
        return RENDERER_SVG.equals(renderer) ? RENDERER_SVG : RENDERER_CANVAS;
    }

    static int getQueryTimeoutSeconds() {
        return bounded(node().getInt(QUERY_TIMEOUT_SECONDS, DEFAULT_QUERY_TIMEOUT_SECONDS), 1, 3600);
    }

    static void initializeDefaults(IPreferenceStore store) {
        store.setDefault(MAX_ROWS, DEFAULT_MAX_ROWS);
        store.setDefault(MAX_CELLS, DEFAULT_MAX_CELLS);
        store.setDefault(QUERY_TIMEOUT_SECONDS, DEFAULT_QUERY_TIMEOUT_SECONDS);
        store.setDefault(DEFAULT_RENDERER, RENDERER_CANVAS);
    }

    private static int bounded(int value, int minimum, int maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }
}
