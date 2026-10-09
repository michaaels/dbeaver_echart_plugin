package org.example.dbeaver.echarts;

import org.eclipse.core.resources.IFile;
import org.eclipse.core.resources.IResource;
import org.eclipse.core.resources.ResourcesPlugin;
import org.eclipse.core.filesystem.EFS;
import org.eclipse.core.runtime.IProgressMonitor;
import org.eclipse.jface.dialogs.MessageDialog;
import org.eclipse.swt.layout.FillLayout;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.ui.IEditorInput;
import org.eclipse.ui.IEditorSite;
import org.eclipse.ui.IFileEditorInput;
import org.eclipse.ui.IURIEditorInput;
import org.eclipse.ui.PartInitException;
import org.eclipse.ui.part.EditorPart;
import org.eclipse.ui.part.FileEditorInput;
import org.eclipse.ui.ide.FileStoreEditorInput;
import org.jkiss.dbeaver.model.app.DBPPlatformDesktop;
import org.jkiss.dbeaver.model.app.DBPProject;
import org.jkiss.dbeaver.runtime.DBWorkbench;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class ReportEditor extends EditorPart {
    public static final String ID = "org.example.dbeaver.echarts.reportEditor";
    private Path file;
    private DBPProject project;
    private EChartsPresentation presentation;
    private String document, savedDocument, diskText;
    private boolean dirty;
    @Override public void init(IEditorSite site, IEditorInput input) throws PartInitException {
        setSite(site); setInput(input);
        try {
            if (input instanceof IFileEditorInput workspace) {
                file = Path.of(workspace.getFile().getLocationURI());
                project = DBPPlatformDesktop.getInstance().getWorkspace().getProject(workspace.getFile().getProject());
            } else if (input instanceof IURIEditorInput uri && "file".equalsIgnoreCase(uri.getURI().getScheme())) {
                file = Path.of(uri.getURI());
                project = DBWorkbench.getPlatform().getWorkspace().getProjects().stream().map(item -> (DBPProject) item)
                    .filter(item -> file.startsWith(item.getAbsolutePath())).findFirst().orElse(DBWorkbench.getPlatform().getWorkspace().getActiveProject());
            } else throw new IllegalArgumentException("Open a local ECharts report template JSON.");
            document = savedDocument = ReportFiles.read(file); diskText = Files.readString(file, StandardCharsets.UTF_8);
            setPartName(file.getFileName().toString());
        } catch (Exception error) { throw new PartInitException("Cannot open report template: " + error.getMessage(), error); }
    }
    @Override public void createPartControl(Composite parent) {
        parent.setLayout(new FillLayout()); presentation = new EChartsPresentation();
        presentation.createReport(parent, document, project, this::changed, this::saveDocument, () -> setDirty(true));
    }
    private void changed(String text) {
        try { document = ReportFiles.canonical(text); setDirty(!document.equals(savedDocument)); }
        catch (RuntimeException error) { setDirty(true); }
    }
    private void setDirty(boolean value) { if (value != dirty) { dirty = value; firePropertyChange(PROP_DIRTY); } }
    private String saveDocument(String text) {
        try {
            if (!Files.exists(file) || !Files.readString(file, StandardCharsets.UTF_8).equals(diskText)) throw new IllegalStateException("The report changed on disk. Reopen it before saving.");
            ReportFiles.write(file, text); document = savedDocument = ReportFiles.read(file); diskText = Files.readString(file, StandardCharsets.UTF_8); setDirty(false);
            var report = ReportFiles.parse(document);
            if (project != null) ReportFiles.updateDefault(project.getAbsolutePath().resolve("Reports/ECharts"), file,
                report.has("defaultTemplate") && report.get("defaultTemplate").getAsBoolean());
            if (project != null) project.refreshProject();
            for (IFile resource : ResourcesPlugin.getWorkspace().getRoot().findFilesForLocationURI(file.toUri())) resource.getParent().refreshLocal(IResource.DEPTH_ONE, null);
            return file.toString();
        } catch (Exception error) { MessageDialog.openError(getSite().getShell(), "Save report template", error.getMessage()); return null; }
    }
    @Override public void doSave(IProgressMonitor monitor) {
        try { if (saveDocument(presentation.currentReportDocument()) != null) presentation.markReportSaved(); }
        catch (Exception error) { MessageDialog.openError(getSite().getShell(), "Save report template", error.getMessage()); }
    }
    @Override public void doSaveAs() {
        try {
            String selected = presentation.saveCurrentReport(true); if (selected == null) return;
            file = Path.of(selected).toAbsolutePath().normalize();
            IFile[] resources = ResourcesPlugin.getWorkspace().getRoot().findFilesForLocationURI(file.toUri());
            setInput(resources.length > 0 ? new FileEditorInput(resources[0]) : new FileStoreEditorInput(EFS.getLocalFileSystem().getStore(file.toUri())));
            document = savedDocument = ReportFiles.read(file); diskText = Files.readString(file, StandardCharsets.UTF_8);
            setPartName(file.getFileName().toString()); setDirty(false); presentation.markReportSaved();
        } catch (Exception error) { MessageDialog.openError(getSite().getShell(), "Save report template as", error.getMessage()); }
    }
    @Override public boolean isSaveAsAllowed() { return true; }
    @Override public boolean isDirty() { return dirty; }
    @Override public void setFocus() { if (presentation != null && presentation.getControl() != null) presentation.getControl().setFocus(); }
    @Override public void dispose() { if (presentation != null) presentation.dispose(); super.dispose(); }
}
