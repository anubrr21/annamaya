package app.annamaya;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Parcelable;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String HOST = "app.annamaya.local";
    private static final String START = "https://" + HOST + "/index.html";
    private static final int PICK_FILE = 71;
    private static final int MOTION_PERMISSION = 72;
    private static final int NOTIFY_PERMISSION = 73;

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private SensorManager sensors;
    private long lastTick;
    private final SensorEventListener live = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent e) {
            long t = StepStore.wallTime(e);
            long count = (long) e.values[0];
            StepStore.record(MainActivity.this, t, count);
            if (t - lastTick < 1500) return;
            lastTick = t;
            if (web != null) web.evaluateJavascript("window.__annamayaStep && window.__annamayaStep(" + count + "," + t + ")", null);
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        s.setUserAgentString(s.getUserAgentString() + " AnnamayaApp");
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.addJavascriptInterface(new Bridge(), "AnnamayaNative");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!HOST.equals(uri.getHost())) return null;
                return bundled(uri.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                return chooseFile(callback, params);
            }
        });

        sensors = getSystemService(SensorManager.class);
        StepJob.schedule(this);
        if (TrackerService.enabled(this) && StepStore.permitted(this)) TrackerService.setEnabled(this, true);
        if (state == null) web.loadUrl(START);
        else web.restoreState(state);
    }

    private WebResourceResponse bundled(String path) {
        if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
        if (!path.contains("..")) {
            try {
                String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
                String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
                boolean text = mime.startsWith("text/") || mime.contains("json") || mime.contains("svg");
                return new WebResourceResponse(mime, text ? "utf-8" : null, getAssets().open("www" + path));
            } catch (IOException ignored) {
            }
        }
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                Collections.<String, String>emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private boolean chooseFile(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        cameraUri = null;

        boolean image = false;
        for (String type : params.getAcceptTypes()) {
            if (type != null && type.startsWith("image/")) image = true;
        }

        Intent camera = null;
        if (image) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.DISPLAY_NAME, "annamaya-" + System.currentTimeMillis() + ".jpg");
            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Annamaya");
            try {
                cameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            } catch (RuntimeException ignored) {
                cameraUri = null;
            }
            if (cameraUri != null) {
                camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                        .putExtra(MediaStore.EXTRA_OUTPUT, cameraUri)
                        .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }
        }

        Intent launch;
        if (camera != null && params.isCaptureEnabled()) {
            launch = camera;
        } else {
            Intent pick = new Intent(Intent.ACTION_GET_CONTENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(image ? "image/*" : "*/*");
            launch = Intent.createChooser(pick, image ? "Plate photo" : "Choose a file");
            if (camera != null) launch.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Parcelable[]{camera});
        }

        try {
            startActivityForResult(launch, PICK_FILE);
        } catch (ActivityNotFoundException e) {
            finishChoice(null);
            Toast.makeText(this, "No app available to pick that file.", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void finishChoice(Uri picked) {
        if (cameraUri != null && !cameraUri.equals(picked)) {
            try {
                getContentResolver().delete(cameraUri, null, null);
            } catch (RuntimeException ignored) {
            }
        }
        cameraUri = null;
        if (fileCallback != null) fileCallback.onReceiveValue(picked == null ? null : new Uri[]{picked});
        fileCallback = null;
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request != PICK_FILE) {
            super.onActivityResult(request, result, data);
            return;
        }
        Uri picked = null;
        if (result == RESULT_OK) {
            picked = data != null && data.getData() != null ? data.getData() : cameraUri;
        }
        finishChoice(picked);
    }

    @Override
    protected void onResume() {
        super.onResume();
        startLive();
    }

    @Override
    protected void onPause() {
        stopLive();
        super.onPause();
    }

    private void startLive() {
        Sensor counter = StepStore.sensor(this, Sensor.TYPE_STEP_COUNTER);
        if (sensors == null || counter == null || !StepStore.permitted(this)) return;
        try {
            sensors.registerListener(live, counter, SensorManager.SENSOR_DELAY_UI);
        } catch (RuntimeException ignored) {
        }
    }

    private void stopLive() {
        if (sensors == null) return;
        try {
            sensors.unregisterListener(live);
        } catch (RuntimeException ignored) {
        }
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == MOTION_PERMISSION && StepStore.permitted(this)) {
            StepJob.schedule(this);
            startLive();
            StepStore.sampleOnce(this, null);
        }
        if (request == NOTIFY_PERMISSION && TrackerService.enabled(this)) TrackerService.setEnabled(this, true);
        web.evaluateJavascript("window.__annamayaMotion && window.__annamayaMotion()", null);
    }

    private String permissionState() {
        if (StepStore.permitted(this)) return "granted";
        boolean asked = StepStore.prefs(this).getBoolean("asked", false);
        if (asked && !shouldShowRequestPermissionRationale(Manifest.permission.ACTIVITY_RECOGNITION)) return "blocked";
        return asked ? "denied" : "prompt";
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.__annamayaBack && window.__annamayaBack()) ? 1 : 0", value -> {
            if (!"1".equals(value)) finish();
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    private class Bridge {
        @JavascriptInterface
        public String motionStatus() {
            boolean counter = StepStore.sensor(MainActivity.this, Sensor.TYPE_STEP_COUNTER) != null;
            boolean barometer = StepStore.sensor(MainActivity.this, Sensor.TYPE_PRESSURE) != null;
            boolean notify = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            return "{\"stepCounter\":" + counter + ",\"barometer\":" + barometer + ",\"permission\":\"" + permissionState()
                    + "\",\"tracking\":" + TrackerService.enabled(MainActivity.this) + ",\"notifications\":" + notify + "}";
        }

        @JavascriptInterface
        public void requestMotionPermission() {
            runOnUiThread(() -> {
                StepStore.prefs(MainActivity.this).edit().putBoolean("asked", true).apply();
                requestPermissions(new String[]{Manifest.permission.ACTIVITY_RECOGNITION}, MOTION_PERMISSION);
            });
        }

        @JavascriptInterface
        public void openAppSettings() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
                } catch (ActivityNotFoundException ignored) {
                }
            });
        }

        @JavascriptInterface
        public String motionSamples(String since) {
            return StepStore.samplesJson(MainActivity.this, parse(since));
        }

        @JavascriptInterface
        public String floorEvents(String since) {
            return StepStore.floorsJson(MainActivity.this, parse(since));
        }

        @JavascriptInterface
        public void refreshSteps() {
            runOnUiThread(() -> StepStore.sampleOnce(MainActivity.this, () -> web.evaluateJavascript("window.__annamayaMotion && window.__annamayaMotion()", null)));
        }

        @JavascriptInterface
        public void setTracking(final boolean on) {
            runOnUiThread(() -> {
                if (on && !StepStore.permitted(MainActivity.this)) return;
                TrackerService.setEnabled(MainActivity.this, on);
                if (on && Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFY_PERMISSION);
                }
            });
        }

        private long parse(String since) {
            try {
                return Long.parseLong(since);
            } catch (NumberFormatException e) {
                return 0;
            }
        }

        @JavascriptInterface
        public void saveFile(String name, String mime, String base64) {
            String message;
            try {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, mime);
                values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Annamaya");
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("no destination");
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) throw new IOException("cannot open destination");
                    out.write(Base64.decode(base64, Base64.DEFAULT));
                }
                message = "Saved to Downloads/Annamaya/" + name;
                if ("application/pdf".equals(mime)) open(uri, mime);
            } catch (IOException | RuntimeException e) {
                message = "Could not save the file.";
            }
            final String text = message;
            runOnUiThread(() -> Toast.makeText(MainActivity.this, text, Toast.LENGTH_LONG).show());
        }

        private void open(final Uri uri, final String mime) {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
                } catch (ActivityNotFoundException ignored) {
                }
            });
        }

        @JavascriptInterface
        public void setBars(final boolean dark) {
            runOnUiThread(() -> {
                Window window = getWindow();
                int color = dark ? 0xFF141210 : 0xFFF1E7D6;
                window.setStatusBarColor(color);
                window.setNavigationBarColor(color);
                window.getDecorView().setBackgroundColor(color);
                int flags = dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                window.getDecorView().setSystemUiVisibility(flags);
            });
        }
    }
}
