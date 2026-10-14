package app.annamaya;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        StepJob.schedule(c);
        if (TrackerService.enabled(c) && StepStore.permitted(c)) TrackerService.setEnabled(c, true);
    }
}
