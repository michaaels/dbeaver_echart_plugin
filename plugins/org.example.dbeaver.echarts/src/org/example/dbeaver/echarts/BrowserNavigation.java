package org.example.dbeaver.echarts;

import java.net.URI;
import java.nio.file.Path;
import java.nio.file.Paths;

/** Navigation policy shared by the chart and report browsers. */
final class BrowserNavigation {
    private BrowserNavigation() { }

    static boolean allows(String location, boolean top, Path allowedRoot) {
        if (location == null || location.isBlank() || "about:blank".equalsIgnoreCase(location)) return true;
        // The email preview is a sandboxed, script-free srcdoc child frame.
        // It must never replace the privileged page that exposes BrowserFunctions.
        if (!top && "about:srcdoc".equalsIgnoreCase(location)) return true;
        try {
            URI uri = URI.create(location);
            return "file".equalsIgnoreCase(uri.getScheme())
                && Paths.get(uri).toAbsolutePath().normalize().startsWith(allowedRoot);
        } catch (Exception e) {
            return false;
        }
    }
}
