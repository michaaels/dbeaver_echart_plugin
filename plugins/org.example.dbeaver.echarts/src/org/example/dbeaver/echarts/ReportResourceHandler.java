package org.example.dbeaver.echarts;

import org.eclipse.core.resources.IFile;
import org.eclipse.core.resources.IResource;
import org.eclipse.core.runtime.CoreException;
import org.eclipse.ui.PlatformUI;
import org.eclipse.ui.part.FileEditorInput;
import org.jkiss.dbeaver.DBException;
import org.jkiss.dbeaver.ui.resources.AbstractResourceHandler;

public final class ReportResourceHandler extends AbstractResourceHandler {
    @Override public int getFeatures(IResource resource) { return resource instanceof IFile ? FEATURE_OPEN | FEATURE_DELETE | FEATURE_RENAME : super.getFeatures(resource); }
    @Override public void openResource(IResource resource) throws CoreException, DBException {
        if (resource instanceof IFile file) PlatformUI.getWorkbench().getActiveWorkbenchWindow().getActivePage().openEditor(new FileEditorInput(file), ReportEditor.ID);
        else super.openResource(resource);
    }
    @Override public String getTypeName(IResource resource) { return "ECharts report template"; }
}
