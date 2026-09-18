import { useEffect, useState, useCallback } from 'react';
import { View, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAccessToken } from '@/lib/session';
import { getLocations, createLocation, deleteLocation, type LocationEntry } from '@/lib/api';
import { Screen, Text, Button, GroupedCard, FieldRow, GRow, SectionLabel } from '@/ui/components';
import { DateField } from '@/ui/date-field';
import { TimeField } from '@/ui/time-field';
import { formatDMY } from '@/lib/format';
import { useTheme } from '@/theme';
import { makeStyles, formatDateTime, type ToastMsg } from './_shared';

export function EventsTab({ setMsg }: { setMsg: (m: ToastMsg | null) => void }) {
  const t = useTheme();
  const s = makeStyles(t);
  const [locations, setLocations] = useState<LocationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getLocations(getAccessToken()!);
      setLocations(res.locations);
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async () => {
    if (!location.trim() || !date.trim() || !time.trim()) {
      setMsg({ text: 'Location, date and time are required.', tone: 'error' });
      return;
    }
    const starts_at = new Date(`${date}T${time}`).toISOString();
    if (isNaN(new Date(starts_at).getTime())) {
      setMsg({ text: 'Invalid date or time.', tone: 'error' });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      await createLocation(getAccessToken()!, { location: location.trim(), starts_at, note: note.trim() || undefined });
      setLocation(''); setDate(''); setTime(''); setNote('');
      setMsg({ text: 'Event saved — it will show on the website.', tone: 'success' });
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
    <>
      <SectionLabel>Add event</SectionLabel>
      <GroupedCard>
        <FieldRow label="Location name" displayValue={location}>
          <TextInput value={location} onChangeText={setLocation} placeholder="e.g. Christchurch Market"
            placeholderTextColor={t.color.textMuted} style={s.input} />
        </FieldRow>
        <FieldRow label="Date" displayValue={formatDMY(date)}>
          <DateField value={date} onChange={setDate} placeholder="Select date" />
        </FieldRow>
        <FieldRow label="Time" displayValue={time}>
          <TimeField value={time} onChange={setTime} placeholder="Select time" />
        </FieldRow>
        <FieldRow label="Note" displayValue={note} last>
          <TextInput value={note} onChangeText={setNote} placeholder="Optional note"
            placeholderTextColor={t.color.textMuted} style={s.input} />
        </FieldRow>
      </GroupedCard>
      <Button label="Save event" onPress={handleCreate} loading={busy} />
      <SectionLabel right={!loading ? <Text variant="small" muted>{locations.length} upcoming</Text> : undefined}>
        Upcoming
      </SectionLabel>
      <GroupedCard>
        {loading ? (
          <GRow last><Text variant="label" muted style={{ flex: 1 }}>Loading…</Text></GRow>
        ) : locations.length === 0 ? (
          <GRow last><Text variant="label" muted style={{ flex: 1 }}>No upcoming events.</Text></GRow>
        ) : (
          locations.map((l, i) => (
            <GRow key={l.id} last={i === locations.length - 1}>
              <View style={s.itemRow}>
                <Text variant="label">{l.location}</Text>
                <Text variant="small" muted>{formatDateTime(l.starts_at)}</Text>
                {!!l.note && <Text variant="small" muted>{l.note}</Text>}
              </View>
              <Pressable onPress={() => handleDelete(l.id)} disabled={busy}
                accessibilityRole="button" accessibilityLabel="Remove event"
                style={s.iconBtn(busy)}>
                <Ionicons name="trash-outline" size={18} color={t.color.danger} />
              </Pressable>
            </GRow>
          ))
        )}
      </GroupedCard>
    </>
  );
}
