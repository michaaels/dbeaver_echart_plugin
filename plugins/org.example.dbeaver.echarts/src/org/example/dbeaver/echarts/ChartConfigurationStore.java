package org.example.dbeaver.echarts;

import org.eclipse.core.runtime.preferences.InstanceScope;
import org.jkiss.dbeaver.model.struct.DBSDataContainer;
import org.jkiss.dbeaver.ui.controls.resultset.IResultSetController;
import org.osgi.service.prefs.BackingStoreException;
import org.osgi.service.prefs.Preferences;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Stores the versioned browser configuration in the Eclipse workspace preferences.
 */
final class ChartConfigurationStore {
    private static final String NODE_NAME = "charts";
    private static final int MAX_CONFIGURATION_LENGTH = 1_048_576;
    private static final int CHUNK_LENGTH = 7_000;

    private final Preferences node;
    private final String key;

    ChartConfigurationStore(String sourceKey) {
        this.node = InstanceScope.INSTANCE.getNode(EChartsPreferences.PLUGIN_ID).node(NODE_NAME);
        this.key = "source." + sha256(sourceKey);
    }

    String load() {
        int parts = node.getInt(partsKey(), 0);
        if (parts <= 0) {
            return node.get(key, null);
        }
        StringBuilder configuration = new StringBuilder(parts * CHUNK_LENGTH);
        for (int part = 0; part < parts; part++) {
            String value = node.get(partKey(part), null);
            if (value == null) {
                return null;
            }
            configuration.append(value);
        }
        return configuration.toString();
    }

    void save(String configuration) {
        if (!isValid(configuration)) {
            return;
        }
        int oldParts = node.getInt(partsKey(), 0);
        int parts = (configuration.length() + CHUNK_LENGTH - 1) / CHUNK_LENGTH;
        for (int part = 0; part < parts; part++) {
            int start = part * CHUNK_LENGTH;
            int end = Math.min(configuration.length(), start + CHUNK_LENGTH);
            node.put(partKey(part), configuration.substring(start, end));
        }
        for (int part = parts; part < oldParts; part++) {
            node.remove(partKey(part));
        }
        node.putInt(partsKey(), parts);
        node.remove(key);
        try {
            node.flush();
        } catch (BackingStoreException ignored) {
            // The in-memory preference value remains available for this session.
        }
    }

    private String partsKey() {
        return key + ".parts";
    }

    private String partKey(int part) {
        return key + ".part." + part;
    }

    static String sourceKey(IResultSetController controller) {
        StringBuilder key = new StringBuilder(128);
        key.append(controller.getSite().getId()).append('|');
        if (controller.getSite().getPart() != null) {
            key.append(controller.getSite().getPart().getTitle()).append('|');
            key.append(controller.getSite().getPart().getTitleToolTip()).append('|');
        }
        DBSDataContainer dataContainer = controller.getDataContainer();
        if (dataContainer != null) {
            key.append(dataContainer.getName());
        }
        return key.toString();
    }

    private static boolean isValid(String configuration) {
        return configuration != null
            && configuration.length() <= MAX_CONFIGURATION_LENGTH
            && configuration.startsWith("{")
            && configuration.endsWith("}")
            && configuration.contains("\"schemaVersion\":1");
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder(digest.length * 2);
            for (byte item : digest) {
                result.append(String.format("%02x", item & 0xff));
            }
            return result.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }
}
