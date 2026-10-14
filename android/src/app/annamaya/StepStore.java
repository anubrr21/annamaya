package app.annamaya;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

final class StepStore {
    static final String PREFS = "annamaya_motion";
    private static final String STEPS_FILE = "steps.csv";
    private static final String FLOORS_FILE = "floors.csv";
    private static final long KEEP_MS = 400L * 24 * 3600 * 1000;
    private static final long MIN_GAP_MS = 60_000L;
    private static final long HEARTBEAT_MS = 30L * 60 * 1000;
    private static final long PRUNE_BYTES = 3L * 1024 * 1024;

    private StepStore() {}

    static boolean permitted(Context c) {
        return c.checkSelfPermission(Manifest.permission.ACTIVITY_RECOGNITION) == PackageManager.PERMISSION_GRANTED;
    }

    static Sensor sensor(Context c, int type) {
        SensorManager sm = c.getSystemService(SensorManager.class);
        return sm == null ? null : sm.getDefaultSensor(type);
    }

    static long wallTime(SensorEvent e) {
        return System.currentTimeMillis() + (e.timestamp - SystemClock.elapsedRealtimeNanos()) / 1_000_000L;
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized void record(Context c, long t, long count) {
        SharedPreferences p = prefs(c);
        long lastT = p.getLong("lastT", 0);
        long lastC = p.getLong("lastC", -1);
        p.edit().putLong("liveT", t).putLong("liveC", count).apply();
        boolean changed = count != lastC;
        boolean due = changed ? t - lastT >= MIN_GAP_MS || count < lastC || lastC < 0 : t - lastT >= HEARTBEAT_MS;
        if (!due) return;
        append(c, STEPS_FILE, t + "," + count + "\n");
        p.edit().putLong("lastT", t).putLong("lastC", count).apply();
    }

    static synchronized void floor(Context c, long t) {
        append(c, FLOORS_FILE, t + "\n");
    }

    private static void append(Context c, String name, String line) {
        File f = new File(c.getFilesDir(), name);
        try (OutputStreamWriter w = new OutputStreamWriter(new FileOutputStream(f, true), StandardCharsets.UTF_8)) {
            w.write(line);
        } catch (IOException ignored) {
        }
        if (f.length() > PRUNE_BYTES) prune(f);
    }

    private static void prune(File f) {
        long cutoff = System.currentTimeMillis() - KEEP_MS;
        List<String> keep = new ArrayList<>();
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String line;
            while ((line = r.readLine()) != null) {
                int comma = line.indexOf(',');
                try {
                    long t = Long.parseLong(comma < 0 ? line : line.substring(0, comma));
                    if (t >= cutoff) keep.add(line);
                } catch (NumberFormatException ignored) {
                }
            }
        } catch (IOException e) {
            return;
        }
        try (OutputStreamWriter w = new OutputStreamWriter(new FileOutputStream(f, false), StandardCharsets.UTF_8)) {
            for (String line : keep) w.write(line + "\n");
        } catch (IOException ignored) {
        }
    }

    static synchronized String samplesJson(Context c, long since) {
        StringBuilder out = new StringBuilder("[");
        File f = new File(c.getFilesDir(), STEPS_FILE);
        long lastT = 0;
        if (f.exists()) {
            try (BufferedReader r = new BufferedReader(new FileReader(f))) {
                String line;
                while ((line = r.readLine()) != null) {
                    int comma = line.indexOf(',');
                    if (comma < 0) continue;
                    try {
                        long t = Long.parseLong(line.substring(0, comma));
                        long n = Long.parseLong(line.substring(comma + 1).trim());
                        if (t < since) continue;
                        if (out.length() > 1) out.append(',');
                        out.append('[').append(t).append(',').append(n).append(']');
                        lastT = t;
                    } catch (NumberFormatException ignored) {
                    }
                }
            } catch (IOException ignored) {
            }
        }
        SharedPreferences p = prefs(c);
        long liveT = p.getLong("liveT", 0);
        if (liveT > lastT && liveT >= since) {
            if (out.length() > 1) out.append(',');
            out.append('[').append(liveT).append(',').append(p.getLong("liveC", 0)).append(']');
        }
        return out.append(']').toString();
    }

    static synchronized String floorsJson(Context c, long since) {
        StringBuilder out = new StringBuilder("[");
        File f = new File(c.getFilesDir(), FLOORS_FILE);
        if (!f.exists()) return "[]";
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String line;
            while ((line = r.readLine()) != null) {
                try {
                    long t = Long.parseLong(line.trim());
                    if (t < since) continue;
                    if (out.length() > 1) out.append(',');
                    out.append(t);
                } catch (NumberFormatException ignored) {
                }
            }
        } catch (IOException ignored) {
        }
        return out.append(']').toString();
    }

    static boolean sampleOnce(Context c, Runnable done) {
        final SensorManager sm = c.getSystemService(SensorManager.class);
        final Sensor counter = sensor(c, Sensor.TYPE_STEP_COUNTER);
        if (sm == null || counter == null || !permitted(c)) return false;
        final Context app = c.getApplicationContext();
        final Handler handler = new Handler(Looper.getMainLooper());
        final boolean[] finished = {false};
        final SensorEventListener[] holder = new SensorEventListener[1];
        final Runnable finish = () -> {
            if (finished[0]) return;
            finished[0] = true;
            try {
                sm.unregisterListener(holder[0]);
            } catch (RuntimeException ignored) {
            }
            if (done != null) done.run();
        };
        holder[0] = new SensorEventListener() {
            @Override
            public void onSensorChanged(SensorEvent e) {
                record(app, wallTime(e), (long) e.values[0]);
                finish.run();
            }

            @Override
            public void onAccuracyChanged(Sensor s, int accuracy) {
            }
        };
        try {
            sm.registerListener(holder[0], counter, SensorManager.SENSOR_DELAY_NORMAL, 0, handler);
        } catch (RuntimeException e) {
            return false;
        }
        handler.postDelayed(finish, 15_000);
        return true;
    }
}
