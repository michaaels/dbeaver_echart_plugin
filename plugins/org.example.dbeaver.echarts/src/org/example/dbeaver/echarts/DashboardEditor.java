package org.example.dbeaver.echarts;

import org.eclipse.core.resources.IFile;
import org.eclipse.core.resources.IResource;
import org.eclipse.core.resources.ResourcesPlugin;
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
import org.jkiss.dbeaver.model.app.DBPPlatformDesktop;
import org.jkiss.dbeaver.model.app.DBPProject;
import org.jkiss.dbeaver.runtime.DBWorkbench;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** A dashboard can outlive its SQL editor and result-set presentation. */
public final class DashboardEditor extends EditorPart {
    public static final String ID = "org.example.dbeaver.echarts.dashboardEditor";
    private Path file;
    private DBPProject project;
    private EChartsPresentation presentation;
    private String document;
    private String savedDocument;
    private String diskText;
    private boolean dirty;

    @Override
    public void init(IEditorSite site, IEditorInput input) throws PartInitException {
        setSite(site);
        setInput(input);
        try {
            if (input instanceof IFileEditorInput workspaceInput) {
                file = Path.of(workspaceInput.getFile().getLocationURI());
                project = DBPPlatformDesktop.getInstance().getWorkspace().getProject(workspaceInput.getFile().getProject());
            } else if (input instanceof IURIEditorInput uriInput && "file".equalsIgnoreCase(uriInput.getURI().getScheme())) {
                file = Path.of(uriInput.getURI());
                project = DBWorkbench.getPlatform().getWorkspace().getProjects().stream()
                    .map(item -> (DBPProject) item)
                    .filter(item -> file.startsWith(item.getAbsolutePath())).findFirst()
                    .orElse(DBWorkbench.getPlatform().getWorkspace().getActiveProject());
            } else { throw new IllegalArgumentException("Open a local ECharts dashboard JSON file."); }
            document = DashboardFiles.read(file);
            savedDocument = document;
            diskText = Files.readString(file, StandardCharsets.UTF_8);
            setPartName(file.getFileName().toString());
        } catch (Exception e) { throw new PartInitException("Cannot open ECharts dashboard: " + e.getMessage(), e); }
    }

    @Override
    public void createPartControl(Composite parent) {
        parent.setLayout(new FillLayout());
        presentation = new EChartsPresentation();
        presentation.createStandalone(parent, document, project, this::configurationChanged, this::saveDocument, () -> setDirty(true));
    }

    private void configurationChanged(String configuration) {
        try {
            var config = com.google.gson.JsonParser.parseString(configuration).getAsJsonObject();
            document = DashboardFiles.canonical(config.get("dashboard").toString());
            setDirty(!document.equals(savedDocument));
        } catch (RuntimeException e) { setDirty(true); }
    }

    private void setDirty(boolean value) {
        if (dirty != value) { dirty = value; firePropertyChange(PROP_DIRTY); }
    }

    private String saveDocument(String text) {
        try {
            // Avoid silently overwriting concurrent edits made in another editor/tool.
            if (!Files.exists(file) || !Files.readString(file, StandardCharsets.UTF_8).equals(diskText)) {
                throw new IllegalStateException("The dashboard changed on disk. Reopen it before saving.");
            }
            DashboardFiles.write(file, text);
            document = DashboardFiles.read(file);
            savedDocument = document;
            diskText = Files.readString(file, StandardCharsets.UTF_8);
            setDirty(false);
            if (project != null) project.refreshProject();
            for (IFile resource : ResourcesPlugin.getWorkspace().getRoot().findFilesForLocationURI(file.toUri())) {
                resource.getParent().refreshLocal(IResource.DEPTH_ONE, null);
            }
            return file.toString();
        } catch (Exception e) {
            MessageDialog.openError(getSite().getShell(), "Save ECharts dashboard", e.getMessage());
            return null;
        }
    }

    @Override
    public void doSave(IProgressMonitor monitor) {
        try {
            // Read current browser state synchronously; do not lose the 250 ms pending update.
            saveDocument(presentation.currentDashboardDocument());
        } catch (Exception e) {
            MessageDialog.openError(getSite().getShell(), "Save ECharts dashboard", e.getMessage());
        }
    }

    @Override
    public void doSaveAs() { }

    @Override
    public boolean isSaveAsAllowed() { return false; }

    @Override
    public boolean isDirty() { return dirty; }

    @Override
    public void setFocus() {
        if (presentation != null && presentation.getControl() != null) presentation.getControl().setFocus();
    }

    @Override
    public void dispose() {
        if (presentation != null) { presentation.dispose(); presentation = null; }
        super.dispose();
    }
}
