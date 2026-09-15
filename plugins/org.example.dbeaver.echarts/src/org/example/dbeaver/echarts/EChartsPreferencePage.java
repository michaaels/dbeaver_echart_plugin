package org.example.dbeaver.echarts;

import org.eclipse.core.runtime.preferences.InstanceScope;
import org.eclipse.jface.preference.ComboFieldEditor;
import org.eclipse.jface.preference.FieldEditorPreferencePage;
import org.eclipse.jface.preference.IntegerFieldEditor;
import org.eclipse.ui.IWorkbench;
import org.eclipse.ui.IWorkbenchPreferencePage;
import org.eclipse.ui.preferences.ScopedPreferenceStore;

/**
 * Preferences exposed under Window > Preferences > ECharts.
 */
public final class EChartsPreferencePage extends FieldEditorPreferencePage implements IWorkbenchPreferencePage {
    public EChartsPreferencePage() {
        super(GRID);
        setPreferenceStore(new ScopedPreferenceStore(
            InstanceScope.INSTANCE,
            EChartsPreferences.PLUGIN_ID
        ));
        EChartsPreferences.initializeDefaults(getPreferenceStore());
        setDescription("Default limits and rendering options for ECharts result presentations.");
    }

    @Override
    protected void createFieldEditors() {
        IntegerFieldEditor maxRows = new IntegerFieldEditor(
            EChartsPreferences.MAX_ROWS,
            "Maximum rows:",
            getFieldEditorParent()
        );
        maxRows.setValidRange(EChartsPreferences.MIN_MAX_ROWS, EChartsPreferences.MAX_MAX_ROWS);
        addField(maxRows);

        IntegerFieldEditor maxCells = new IntegerFieldEditor(
            EChartsPreferences.MAX_CELLS,
            "Maximum cells:",
            getFieldEditorParent()
        );
        maxCells.setValidRange(EChartsPreferences.MIN_MAX_CELLS, EChartsPreferences.MAX_MAX_CELLS);
        addField(maxCells);

        addField(new ComboFieldEditor(
            EChartsPreferences.DEFAULT_RENDERER,
            "Default renderer:",
            new String[][] {
                {"Canvas", EChartsPreferences.RENDERER_CANVAS},
                {"SVG", EChartsPreferences.RENDERER_SVG}
            },
            getFieldEditorParent()
        ));
    }

    @Override
    public void init(IWorkbench workbench) {
        // The scoped preference store is initialized in the constructor.
    }
}
