# P2 update site

Import this directory as an Eclipse Update Site project together with the plugin
and feature projects. In Eclipse PDE, open `category.xml`, select **Build All**,
and publish the generated repository directory to the chosen static hosting.

The checked-in project is the reproducible channel definition. Generated
`artifacts.jar`, `content.jar`, `features/` and `plugins/` files are release
outputs and are intentionally not committed.
