package app.organify.personal;

import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.widget.Toast;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

public class UpdateActivity extends MainActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (savedInstanceState == null) {
            new Thread(this::checkForUpdate, "organify-apk-update").start();
        }
    }

    private void checkForUpdate() {
        try {
            String endpoint = readText(getAssets().open("organify-update-endpoint.txt")).trim();
            if (endpoint.isEmpty()) return;

            HttpsURLConnection connection = (HttpsURLConnection) new URL(endpoint).openConnection();
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            connection.setUseCaches(false);
            JSONObject release;
            try {
                release = new JSONObject(readText(connection.getInputStream()));
            } finally {
                connection.disconnect();
            }

            PackageInfo installed = getPackageManager().getPackageInfo(getPackageName(), 0);
            long installedCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? installed.getLongVersionCode() : installed.versionCode;
            if (!getPackageName().equals(release.getString("applicationId"))
                    || release.getLong("versionCode") <= installedCode) return;

            URL apk = new URL(release.getString("apkUrl"));
            if (!"https".equalsIgnoreCase(apk.getProtocol()) || apk.getHost().isEmpty()) return;
            runOnUiThread(() -> offerUpdate(Uri.parse(apk.toExternalForm())));
        } catch (Exception error) {
            Log.w("OrganifyUpdater", "No se pudo comprobar la actualización", error);
        }
    }

    private void offerUpdate(Uri apk) {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this)
            .setTitle("Actualización disponible")
            .setMessage("Descarga el nuevo APK y ábrelo para instalar la actualización.")
            .setNegativeButton("Más tarde", null)
            .setPositiveButton("Descargar APK", (dialog, button) -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, apk));
                } catch (ActivityNotFoundException error) {
                    Toast.makeText(this, "No se encontró un navegador para descargar el APK.",
                        Toast.LENGTH_LONG).show();
                }
            })
            .show();
    }

    private static String readText(InputStream input) throws IOException {
        try (InputStreamReader reader = new InputStreamReader(input, StandardCharsets.UTF_8)) {
            char[] buffer = new char[1024];
            StringBuilder text = new StringBuilder();
            int count;
            while ((count = reader.read(buffer)) != -1) {
                if (text.length() + count > 16_384) throw new IOException("Documento demasiado grande");
                text.append(buffer, 0, count);
            }
            return text.toString();
        }
    }
}
