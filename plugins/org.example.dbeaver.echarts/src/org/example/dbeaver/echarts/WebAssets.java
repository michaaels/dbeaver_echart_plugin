package org.example.dbeaver.echarts;

import org.eclipse.core.runtime.FileLocator;
import org.osgi.framework.Bundle;
import org.osgi.framework.FrameworkUtil;

import java.io.IOException;
import java.net.URL;

final class WebAssets {
    private WebAssets() {
    }

    static URL resolve(String path) throws IOException {
        Bundle bundle = FrameworkUtil.getBundle(WebAssets.class);
        if (bundle == null) {
            throw new IOException("OSGi bundle is not available");
        }
        URL entry = bundle.getEntry(path);
        if (entry == null) {
            throw new IOException("Missing plugin resource: " + path);
        }
        return FileLocator.toFileURL(entry);
    }
}
