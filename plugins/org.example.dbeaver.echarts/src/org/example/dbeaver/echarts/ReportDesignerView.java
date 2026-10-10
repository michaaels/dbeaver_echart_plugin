package org.example.dbeaver.echarts;

import org.eclipse.core.runtime.IProgressMonitor;
import org.eclipse.jface.dialogs.MessageDialog;
import org.eclipse.swt.layout.FillLayout;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.ui.ISaveablePart;
import org.eclipse.ui.part.ViewPart;
import org.jkiss.dbeaver.runtime.DBWorkbench;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Workbench entry for a new report; saved templates reopen in ReportEditor. */
public final class ReportDesignerView extends ViewPart implements ISaveablePart {
    public static final String ID = "org.example.dbeaver.echarts.reportDesigner";
    private EChartsPresentation presentation;
    private boolean dirty;
    @Override public void createPartControl(Composite parent) {
        parent.setLayout(new FillLayout());
        var project = DBWorkbench.getPlatform().getWorkspace().getActiveProject();
        String initial = ReportFiles.empty();
        if (project != null) {
            Path folder = project.getAbsolutePath().resolve("Reports/ECharts").toAbsolutePath().normalize(), marker = folder.resolve(".default-template");
            try {
                if (Files.isRegularFile(marker) && Files.size(marker) < 4096) {
                    Path template = folder.resolve(Files.readString(marker, StandardCharsets.UTF_8)).normalize();
                    if (template.startsWith(folder) && Files.isRegularFile(template)) initial = ReportFiles.read(template);
                }
            } catch (Exception error) { MessageDialog.openWarning(parent.getShell(), "Report Designer", "The default template could not be opened. A blank report was created."); }
        }
        presentation = new EChartsPresentation();
        presentation.createReport(parent, initial, project, configuration -> setDirty(true), null, () -> setDirty(true));
        presentation.setReportSavedListener(() -> setDirty(false));
    }
    boolean load(String document) {
        if (dirty && !MessageDialog.openConfirm(getSite().getShell(), "Report Designer", "Replace the current report? Save it first to keep its changes.")) return false;
        presentation.loadReport(document); setDirty(true); return true;
    }
    private void setDirty(boolean value) { if (value != dirty) { dirty = value; firePropertyChange(PROP_DIRTY); } }
    @Override public void doSave(IProgressMonitor monitor) { save(false); }
    @Override public void doSaveAs() { save(true); }
    private void save(boolean as) {
        try { if (presentation.saveCurrentReport(as) != null) presentation.markReportSaved(); }
        catch (Exception error) { MessageDialog.openError(getSite().getShell(), "Save report template", error.getMessage()); }
    }
    @Override public boolean isDirty() { return dirty; }
    @Override public boolean isSaveAsAllowed() { return true; }
    @Override public boolean isSaveOnCloseNeeded() { return true; }
    @Override public void setFocus() { if (presentation != null && presentation.getControl() != null) presentation.getControl().setFocus(); }
    @Override public void dispose() { if (presentation != null) presentation.dispose(); super.dispose(); }
}
