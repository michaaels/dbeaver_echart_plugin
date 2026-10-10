package org.example.dbeaver.echarts;

import java.nio.file.Path;

public class BrowserNavigationTest {
    public static void main(String[] args) {
        Path root = Path.of("web").toAbsolutePath().normalize();
        check(BrowserNavigation.allows("about:srcdoc", false, root), "Allow sandboxed email preview");
        check(!BrowserNavigation.allows("about:srcdoc", true, root), "Reject privileged page replacement");
        check(BrowserNavigation.allows(root.resolve("report.html").toUri().toString(), true, root), "Allow bundled page");
        check(!BrowserNavigation.allows(root.resolve("../private.html").toUri().toString(), false, root), "Reject path escape");
        for (String location : new String[] {"https://example.com", "data:text/html,hello", "javascript:alert(1)", "about:config", "file://["}) {
            check(!BrowserNavigation.allows(location, true, root), "Reject top navigation: " + location);
            check(!BrowserNavigation.allows(location, false, root), "Reject child navigation: " + location);
        }
        System.out.println("Browser navigation OK: sandboxed email preview and external-navigation isolation");
    }
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
}
