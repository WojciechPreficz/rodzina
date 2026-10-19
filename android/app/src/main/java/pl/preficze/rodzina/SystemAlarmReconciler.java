package pl.preficze.rodzina;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Reconciles durable registration receipts with the native alarm operations. */
final class SystemAlarmReconciler {
    record Alarm(int id, long fireAt, String fingerprint) {}
    record Result(List<Integer> registeredIds, List<Integer> failedIds) {}
    interface Registry {
        boolean hasOperation(int id);
        void register(Alarm alarm) throws Exception;
    }

    static Result reconcile(List<Alarm> alarms, Map<Integer, String> receipts,
                            Set<Integer> forceIds, long now, Registry registry) {
        List<Integer> registered = new ArrayList<>();
        List<Integer> failed = new ArrayList<>();
        Set<Integer> futureIds = new HashSet<>();
        for (Alarm alarm : alarms) {
            if (alarm.fireAt() <= now) continue;
            futureIds.add(alarm.id());
            boolean ready = alarm.fingerprint().equals(receipts.get(alarm.id()))
                && registry.hasOperation(alarm.id()) && !forceIds.contains(alarm.id());
            if (!ready) {
                receipts.remove(alarm.id());
                try {
                    registry.register(alarm);
                    receipts.put(alarm.id(), alarm.fingerprint());
                    ready = true;
                } catch (Exception error) {
                    failed.add(alarm.id());
                }
            }
            if (ready) registered.add(alarm.id());
        }
        receipts.keySet().retainAll(futureIds);
        return new Result(registered, failed);
    }
}
