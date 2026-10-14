package app.annamaya;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

public class StepJob extends JobService {
    private static final int ID = 7101;

    static void schedule(Context c) {
        if (!StepStore.permitted(c)) return;
        JobScheduler js = c.getSystemService(JobScheduler.class);
        if (js == null || js.getPendingJob(ID) != null) return;
        JobInfo info = new JobInfo.Builder(ID, new ComponentName(c, StepJob.class))
                .setPeriodic(15L * 60 * 1000)
                .setPersisted(true)
                .build();
        try {
            js.schedule(info);
        } catch (RuntimeException ignored) {
        }
    }

    @Override
    public boolean onStartJob(final JobParameters params) {
        return StepStore.sampleOnce(this, () -> jobFinished(params, false));
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        return true;
    }
}
