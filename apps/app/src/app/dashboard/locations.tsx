import { useEffect, useState } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { getAccessToken } from '@/lib/session';
import { getLocations, createLocation, deleteLocation, type LocationEntry } from '@/lib/api';
import { Screen, Text, Card, Button, Notice } from '@/ui/components';
import { useTheme } from '@/theme';

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

  // Form state
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
    // Combine date + time into an ISO string
    const starts_at = new Date(`${date}T${time}`).toISOString();
    if (isNaN(new Date(starts_at).getTime())) {
      setMsg({ text: 'Invalid date or time — use YYYY-MM-DD and HH:MM.', tone: 'error' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await createLocation(getAccessToken()!, {
        location: location.trim(),
        starts_at,
        note: note.trim() || undefined,
      });
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
    setBusy(true);
    setMsg(null);
    try {
      await deleteLocation(getAccessToken()!, id);
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const s = StyleSheet.create({
    input: {
      borderWidth: 1,
      borderColor: t.color.border,
      borderRadius: 8,
      padding: 10,
      fontSize: 15,
      color: t.color.text,
      backgroundColor: t.color.surface,
      marginBottom: 10,
    },
    row: { flexDirection: 'row', gap: 10 },
    half: { flex: 1 },
    itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
    itemDetail: { flex: 1, gap: 2 },
  });

  return (
    <Screen>
      <Text variant="title">Location Banner</Text>
      <Text muted>Add an upcoming or current location. It will appear as a banner on the website automatically and disappear 3 hours after the start time.</Text>

      <Card>
        <Text variant="heading">Add location</Text>
        <TextInput
          style={s.input}
          placeholder="Location name (e.g. Stroud Farmers Market)"
          placeholderTextColor={t.color.textMuted}
          value={location}
          onChangeText={setLocation}
        />
        <View style={s.row}>
          <TextInput
            style={[s.input, s.half]}
            placeholder="Date — YYYY-MM-DD"
            placeholderTextColor={t.color.textMuted}
            value={date}
            onChangeText={setDate}
            keyboardType="numeric"
          />
          <TextInput
            style={[s.input, s.half]}
            placeholder="Time — HH:MM"
            placeholderTextColor={t.color.textMuted}
            value={time}
            onChangeText={setTime}
            keyboardType="numeric"
          />
        </View>
        <TextInput
          style={s.input}
          placeholder="Optional note (e.g. We'll be here 11am–3pm)"
          placeholderTextColor={t.color.textMuted}
          value={note}
          onChangeText={setNote}
        />
        <Button label="Save location" onPress={handleCreate} loading={busy} />
      </Card>

      {msg && <Notice message={msg.text} tone={msg.tone} />}

      <Card>
        <Text variant="heading">Upcoming</Text>
        {loading ? (
          <Text muted>Loading…</Text>
        ) : locations.length === 0 ? (
          <Text muted>No upcoming locations — add one above.</Text>
        ) : (
          locations.map((l) => (
            <View key={l.id} style={s.itemRow}>
              <View style={s.itemDetail}>
                <Text variant="label">{l.location}</Text>
                <Text variant="small" muted>{formatDate(l.starts_at)}</Text>
                {l.note ? <Text variant="small" muted>{l.note}</Text> : null}
              </View>
              <Button label="Remove" variant="ghost" onPress={() => handleDelete(l.id)} loading={busy} />
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}
