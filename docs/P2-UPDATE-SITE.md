# P2 update channel

Version 0.5 includes an Eclipse PDE update-site project at
`sites/org.example.dbeaver.echarts.site`.

## Build locally

1. Import the plugin, feature and site projects into the Eclipse PDE workspace.
2. Set the supported DBeaver installation as the target platform.
3. Open the site's `category.xml` and choose **Build All**.
4. Serve or upload the generated repository as static files.
5. In DBeaver, use **Help → Install New Software** with that repository URL.

Hosting credentials and a public release URL are deployment concerns and are
not stored in this repository. Before publishing a release, run the compatibility
gate described in `COMPATIBILITY.md` and replace the PDE qualifier with the build
qualifier used by the generated feature and bundle.
