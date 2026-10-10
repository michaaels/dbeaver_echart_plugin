package org.example.dbeaver.echarts;

import org.eclipse.core.runtime.QualifiedName;
import org.eclipse.core.runtime.content.IContentDescription;
import org.eclipse.core.runtime.content.IContentDescriber;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import com.google.gson.JsonParser;

/** Recognize our marker without assigning every JSON file to the dashboard editor. */
public final class DashboardContentDescriber implements IContentDescriber {
    @Override
    public int describe(InputStream contents, IContentDescription description) throws IOException {
        byte[] bytes = contents.readNBytes(DashboardFiles.MAX_BYTES + 1);
        if (bytes.length > DashboardFiles.MAX_BYTES) return INVALID;
        try {
            var document = JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8)).getAsJsonObject();
            return DashboardFiles.FORMAT.equals(JsonFields.string(document, "format")) ? VALID : INVALID;
        } catch (RuntimeException ignored) { return INVALID; }
    }

    @Override
    public QualifiedName[] getSupportedOptions() { return new QualifiedName[0]; }
}
