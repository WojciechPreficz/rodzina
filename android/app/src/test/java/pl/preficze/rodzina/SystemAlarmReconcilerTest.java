package pl.preficze.rodzina;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class SystemAlarmReconcilerTest {
    private final long now = 1000;
    private final SystemAlarmReconciler.Alarm alarm = new SystemAlarmReconciler.Alarm(7, 5000, "payload-a");
    private static class Registry implements SystemAlarmReconciler.Registry {
        final Set<Integer> operations = new HashSet<>();
        final List<Integer> registrations = new ArrayList<>();
        int failId = -1;
        public boolean hasOperation(int id) { return operations.contains(id); }
        public void register(SystemAlarmReconciler.Alarm alarm) throws Exception {
            if (alarm.id() == failId) throw new Exception("Permission revoked");
            operations.add(alarm.id());
            registrations.add(alarm.id());
        }
    }

    @Test public void registersOnceAndReusesReceiptsAcrossNativeRestarts() {
        Map<Integer, String> receipts = new HashMap<>();
        Registry registry = new Registry();
        assertEquals(List.of(7), SystemAlarmReconciler.reconcile(List.of(alarm), receipts, Set.of(), now, registry).registeredIds());
        SystemAlarmReconciler.reconcile(List.of(alarm), new HashMap<>(receipts), Set.of(), now, registry);
        assertEquals(List.of(7), registry.registrations);
    }

    @Test public void recreatesMissingOperationsDespiteAnExistingReceipt() {
        Map<Integer, String> receipts = new HashMap<>(Map.of(7, "payload-a"));
        Registry registry = new Registry();
        SystemAlarmReconciler.reconcile(List.of(alarm), receipts, Set.of(), now, registry);
        assertEquals(List.of(7), registry.registrations);
    }

    @Test public void changesAndPluginReschedulingReplaceTheAlarmUnderTheSameId() {
        Map<Integer, String> receipts = new HashMap<>(Map.of(7, "old-payload"));
        Registry registry = new Registry();
        registry.operations.add(7);
        SystemAlarmReconciler.reconcile(List.of(alarm), receipts, Set.of(), now, registry);
        assertEquals("payload-a", receipts.get(7));
        SystemAlarmReconciler.reconcile(List.of(alarm), receipts, Set.of(7), now, registry);
        assertEquals(List.of(7, 7), registry.registrations);
    }

    @Test public void partialFailureNeverConfirmsTheFailedRegistrationAndIsRetryable() {
        Map<Integer, String> receipts = new HashMap<>(Map.of(7, "stale"));
        Registry registry = new Registry();
        registry.failId = 7;
        List<SystemAlarmReconciler.Alarm> alarms = List.of(alarm, new SystemAlarmReconciler.Alarm(8, 7000, "payload-b"));
        SystemAlarmReconciler.Result result = SystemAlarmReconciler.reconcile(alarms, receipts, Set.of(), now, registry);
        assertEquals(List.of(8), result.registeredIds());
        assertEquals(List.of(7), result.failedIds());
        assertFalse(receipts.containsKey(7));
        registry.failId = -1;
        assertEquals(List.of(7, 8), SystemAlarmReconciler.reconcile(alarms, receipts, Set.of(), now, registry).registeredIds());
        assertEquals(List.of(8, 7), registry.registrations);
    }

    @Test public void expiredOrRemovedPayloadsLoseTheirReceiptsAndAreNeverResurrected() {
        Map<Integer, String> receipts = new HashMap<>(Map.of(7, "payload-a", 9, "removed"));
        Registry registry = new Registry();
        SystemAlarmReconciler.Result result = SystemAlarmReconciler.reconcile(List.of(alarm), receipts, Set.of(), 5000, registry);
        assertTrue(result.registeredIds().isEmpty());
        assertTrue(receipts.isEmpty());
        assertTrue(registry.registrations.isEmpty());
    }
}
