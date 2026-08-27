import { useEffect, useState } from 'react';
import { View, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAccessToken } from '@/lib/session';
import { getLocations, createLocation, deleteLocation, type LocationEntry } from '@/lib/api';
import { Screen, Text, Button, GroupedCard, FieldRow, GRow, SectionLabel } from '@/ui/components';
import { DateField } from '@/ui/date-field';
import { TimeField } from '@/ui/time-field';
import { formatDMY } from '@/lib/format';
import { useTheme } from '@/theme';

function inputStyle(t: ReturnType<typeof useTheme>) {
  return {
    backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border,
    borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14,
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function Locations() {
  const t = useTheme();
  const [locations, setLocations] = useState<LocationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' | 'info' } | null>(null);

  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await getLocations(getAccessToken()!);
      setLocations(res.locations);
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleCreate = async () => {
    if (!location.trim() || !date.trim() || !time.trim()) {
      setMsg({ text: 'Location, date and time are required.', tone: 'error' });
      return;
    }
    const starts_at = new Date(`${date}T${time}`).toISOString();
    if (isNaN(new Date(starts_at).getTime())) {
      setMsg({ text: 'Invalid date or time — use YYYY-MM-DD and HH:MM.', tone: 'error' });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      await createLocation(getAccessToken()!, { location: location.trim(), starts_at, note: note.trim() || undefined });
      setLocation(''); setDate(''); setTime(''); setNote('');
      setMsg({ text: 'Location saved — it will show on the website.', tone: 'success' });
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(true); setMsg(null);
    try {
      await deleteLocation(getAccessToken()!, id);
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <SectionLabel>Add location</SectionLabel>
      <GroupedCard>
        <FieldRow label="Location name" displayValue={location}>
          <TextInput value={location} onChangeText={setLocation} placeholder="e.g. Christchurch Market"
            placeholderTextColor={t.color.textMuted} style={inputStyle(t)} />
        </FieldRow>
        <FieldRow label="Date" displayValue={formatDMY(date)}>
          <DateField value={date} onChange={setDate} placeholder="Select date" />
        </FieldRow>
        <FieldRow label="Time" displayValue={time}>
          <TimeField value={time} onChange={setTime} placeholder="Select time" />
        </FieldRow>
        <FieldRow label="Note" displayValue={note} last>
          <TextInput value={note} onChangeText={setNote} placeholder="Optional note"
            placeholderTextColor={t.color.textMuted} style={inputStyle(t)} />
        </FieldRow>
      </GroupedCard>
      <Button label="Save location" onPress={handleCreate} loading={busy} />

      <SectionLabel right={!loading ? <Text variant="small" muted>{locations.length} upcoming</Text> : undefined}>
        Upcoming
      </SectionLabel>
      <GroupedCard>
        {loading ? (
          <GRow last>
            <Text variant="label" muted style={{ flex: 1 }}>Loading…</Text>
          </GRow>
        ) : locations.length === 0 ? (
          <GRow last>
            <Text variant="label" muted style={{ flex: 1 }}>No upcoming locations.</Text>
          </GRow>
        ) : (
          locations.map((l, i) => (
            <GRow key={l.id} last={i === locations.length - 1}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="label">{l.location}</Text>
                <Text variant="small" muted>{formatDate(l.starts_at)}</Text>
                {!!l.note && <Text variant="small" muted>{l.note}</Text>}
              </View>
              <Pressable
                onPress={() => handleDelete(l.id)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Remove location"
                style={{ padding: t.space.sm, opacity: busy ? 0.4 : 1 }}
              >
                <Ionicons name="trash-outline" size={18} color={t.color.danger} />
              </Pressable>
            </GRow>
          ))
        )}
      </GroupedCard>
    </Screen>
  );
}
