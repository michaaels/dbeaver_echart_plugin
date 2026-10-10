package org.example.dbeaver.echarts;

import org.eclipse.core.runtime.QualifiedName;
import org.eclipse.core.runtime.content.IContentDescription;
import org.eclipse.core.runtime.content.IContentDescriber;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import com.google.gson.JsonParser;

public final class ReportContentDescriber implements IContentDescriber {
    @Override public int describe(InputStream contents, IContentDescription description) throws IOException {
        byte[] bytes = contents.readNBytes(ReportFiles.MAX_BYTES + 1);
        if (bytes.length > ReportFiles.MAX_BYTES) return INVALID;
        try { return ReportFiles.FORMAT.equals(JsonFields.string(JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8)).getAsJsonObject(), "format")) ? VALID : INVALID; }
        catch (RuntimeException invalid) { return INVALID; }
    }
    @Override public QualifiedName[] getSupportedOptions() { return new QualifiedName[0]; }
}
