package app.annamaya;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.IBinder;

import java.util.ArrayDeque;
import java.util.Iterator;

public class TrackerService extends Service implements SensorEventListener {
    private static final String CHANNEL = "tracking";
    private static final int NOTIFICATION_ID = 41;
    private static final double FLOOR_M = 3.0;
    private static final long CLIMB_WINDOW_MS = 3L * 60 * 1000;
    private static final long STEPS_PER_FLOOR = 10;
    private static final long HISTORY_MS = 10L * 60 * 1000;

    private SensorManager sm;
    private final ArrayDeque<long[]> stepHistory = new ArrayDeque<>();
    private double smoothed = Double.NaN;
    private double base = Double.NaN;
    private long baseT;
    private long baseSteps;

    static void setEnabled(Context c, boolean on) {
        StepStore.prefs(c).edit().putBoolean("tracking", on).apply();
        Intent i = new Intent(c, TrackerService.class);
        try {
            if (on) c.startForegroundService(i);
            else c.stopService(i);
        } catch (RuntimeException ignored) {
        }
    }

    static boolean enabled(Context c) {
        return StepStore.prefs(c).getBoolean("tracking", false);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Activity tracking", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while Annamaya counts steps and floors continuously.");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat)
                .setContentTitle("Counting steps and floors")
                .setContentText("Annamaya is tracking your movement. Tap to open.")
                .setContentIntent(open)
                .setOngoing(true)
                .build();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH);
            else startForeground(NOTIFICATION_ID, n);
        } catch (RuntimeException e) {
            stopSelf();
            return;
        }
        sm = getSystemService(SensorManager.class);
        if (sm == null || !StepStore.permitted(this)) {
            stopSelf();
            return;
        }
        Sensor counter = StepStore.sensor(this, Sensor.TYPE_STEP_COUNTER);
        Sensor pressure = StepStore.sensor(this, Sensor.TYPE_PRESSURE);
        try {
            if (counter != null) sm.registerListener(this, counter, SensorManager.SENSOR_DELAY_NORMAL, 30_000_000);
            if (pressure != null) sm.registerListener(this, pressure, 1_000_000, 30_000_000);
        } catch (RuntimeException ignored) {
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (sm != null) {
            try {
                sm.unregisterListener(this);
            } catch (RuntimeException ignored) {
            }
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        long t = StepStore.wallTime(e);
        if (e.sensor.getType() == Sensor.TYPE_STEP_COUNTER) {
            long count = (long) e.values[0];
            StepStore.record(this, t, count);
            stepHistory.addLast(new long[]{t, count});
            while (!stepHistory.isEmpty() && t - stepHistory.peekFirst()[0] > HISTORY_MS) stepHistory.removeFirst();
        } else if (e.sensor.getType() == Sensor.TYPE_PRESSURE) {
            onPressure(t, e.values[0]);
        }
    }

    private long stepsAt(long t) {
        long best = -1;
        Iterator<long[]> it = stepHistory.iterator();
        while (it.hasNext()) {
            long[] s = it.next();
            if (s[0] <= t) best = s[1];
            else break;
        }
        if (best < 0 && !stepHistory.isEmpty()) best = stepHistory.peekFirst()[1];
        return best;
    }

    private void onPressure(long t, float hPa) {
        if (hPa <= 0) return;
        double altitude = SensorManager.getAltitude(SensorManager.PRESSURE_STANDARD_ATMOSPHERE, hPa);
        smoothed = Double.isNaN(smoothed) ? altitude : smoothed + 0.15 * (altitude - smoothed);
        long steps = stepsAt(t);
        if (Double.isNaN(base) || t - baseT > CLIMB_WINDOW_MS || smoothed < base) {
            base = smoothed;
            baseT = t;
            baseSteps = steps;
            return;
        }
        if (smoothed - base >= FLOOR_M) {
            boolean walked = steps >= 0 && baseSteps >= 0 && steps - baseSteps >= STEPS_PER_FLOOR;
            if (walked) StepStore.floor(this, t);
            base += FLOOR_M;
            baseT = t;
            baseSteps = steps;
        }
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
    }
}
