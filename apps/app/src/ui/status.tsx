import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { Text, Card, Button } from './components';

// Shared status vocabulary for the vessel module — one colour language, used by
// every section (faults now; maintenance/compliance/… later) so the whole app
// reads the same. green = ok · amber = due soon · red = overdue/critical ·
// grey = closed/inactive.
export type StatusLevel = 'ok' | 'due' | 'over' | 'closed' | 'info';

export function useLevelColor(): (level: StatusLevel) => string {
  const t = useTheme();
  return (level) => ({
    ok: t.color.success,
    due: t.color.warning,
    over: t.color.danger,
    closed: t.color.textMuted,
    info: t.color.textMuted,
  }[level]);
}

// A coloured status pill (dot + label). Distinct from the neutral <Badge>: this
// one carries the level colour, so status is glanceable.
export function StatusBadge({ level, label }: { level: StatusLevel; label: string }) {
  const t = useTheme();
  const c = useLevelColor()(level);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3, paddingHorizontal: t.space.sm, borderRadius: t.radius.pill, backgroundColor: c + '22' }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
      <Text variant="small" color={c}>{label}</Text>
    </View>
  );
}

// Fault urgency → level (consistent colour wherever urgency shows).
export function urgencyLevel(urgency?: string | null): StatusLevel {
  if (urgency === 'Critical' || urgency === 'High') return 'over';
  if (urgency === 'Medium') return 'due';
  return 'info';
}

// ── Shared offline affordances (used across vessel routes) ──────────────────
export function OfflineBanner({ offline }: { offline: boolean }) {
  const t = useTheme();
  if (!offline) return null;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
        <Ionicons name="cloud-offline-outline" size={18} color={t.color.textMuted} />
        <Text variant="small" muted style={{ flex: 1 }}>Showing saved data — you&apos;re offline.</Text>
      </View>
    </Card>
  );
}

export function PendingSyncBanner({ count, onSync, busy }: { count: number; onSync: () => void; busy?: boolean }) {
  const t = useTheme();
  if (count <= 0) return null;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
        <Ionicons name="cloud-offline-outline" size={20} color={t.color.accent} />
        <Text variant="label" style={{ flex: 1 }}>{count} change{count > 1 ? 's' : ''} waiting to sync</Text>
        <Button label="Sync now" variant="secondary" onPress={onSync} loading={busy} />
      </View>
    </Card>
  );
}
