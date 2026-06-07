import { View } from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/theme';
import { Screen, Text, Card, Badge } from '@/ui/components';

// Overview — the dashboard landing. Greeting + at-a-glance cards + activity.
// Cards here are placeholders the client fills with their real data/metrics.
export default function Overview() {
  const t = useTheme();
  const { features } = useAuth();

  const enabled = features
    ? Object.entries(features).filter(([, on]) => on).map(([k]) => k)
    : [];

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <Text variant="title">Overview</Text>
        <Text muted>{today}</Text>
      </View>

      {/* Stat cards — replace with real metrics per client */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.lg }}>
        <Card style={{ flex: 1, minWidth: 160 }}>
          <Text variant="small" muted>MEMBERS</Text>
          <Text variant="title">—</Text>
          <Text variant="small" muted>wire to your data</Text>
        </Card>
        <Card style={{ flex: 1, minWidth: 160 }}>
          <Text variant="small" muted>ACTIVE</Text>
          <Text variant="title">—</Text>
          <Text variant="small" muted>wire to your data</Text>
        </Card>
        <Card style={{ flex: 1, minWidth: 160 }}>
          <Text variant="small" muted>THIS MONTH</Text>
          <Text variant="title">—</Text>
          <Text variant="small" muted>wire to your data</Text>
        </Card>
      </View>

      <Card>
        <Text variant="heading">Enabled modules</Text>
        {enabled.length === 0
          ? <Text muted>No feature modules enabled. Toggle FEATURE_* in the api .env.</Text>
          : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
              {enabled.map((f) => <Badge key={f} label={f} tone="success" />)}
            </View>}
      </Card>

      <Card>
        <Text variant="heading">Recent activity</Text>
        <Text muted>Nothing yet — this is where the client surfaces their feed.</Text>
      </Card>
    </Screen>
  );
}
