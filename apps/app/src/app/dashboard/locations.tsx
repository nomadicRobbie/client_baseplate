import { useEffect, useState, useCallback } from 'react';
import { View, Pressable, TextInput, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAccessToken } from '@/lib/session';
import {
  getLocations, createLocation, deleteLocation, type LocationEntry,
  getWebsiteContent, createWebsiteContent, updateWebsiteContent, deleteWebsiteContent,
  type WebsiteContent, type WebsiteContentType,
} from '@/lib/api';
import { Screen, Text, Button, GroupedCard, FieldRow, GRow, SectionLabel, Pill } from '@/ui/components';
import { DateField } from '@/ui/date-field';
import { TimeField } from '@/ui/time-field';
import { formatDMY } from '@/lib/format';
import { useTheme } from '@/theme';

type Tab = 'events' | 'banners' | 'announcements' | 'info';

const TAB_CONTENT_TYPE: Record<Exclude<Tab, 'events'>, WebsiteContentType> = {
  banners: 'banner',
  announcements: 'announcement',
  info: 'info',
};

function makeStyles(t: ReturnType<typeof useTheme>) {
  return {
    tabRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm, marginBottom: t.space.sm },
    itemRow: { flex: 1, gap: 2 },
    rowActions: { flexDirection: 'row' as const, gap: t.space.sm, alignItems: 'center' as const },
    iconBtn: (busy: boolean) => ({ padding: t.space.sm, opacity: busy ? 0.4 : 1 }),
    input: {
      backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border,
      borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14,
    },
    inputMulti: {
      backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border,
      borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14,
      minHeight: 72, textAlignVertical: 'top' as const,
    },
    switchRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, minHeight: 44 },
    badge: (published: boolean) => ({
      alignSelf: 'flex-start' as const,
      backgroundColor: published ? t.color.successMuted : t.color.surfaceAlt,
      borderRadius: t.radius.pill, paddingVertical: 2, paddingHorizontal: t.space.sm,
    }),
  };
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// ── Events tab (existing locations) ─────────────────────────────────────────

function EventsTab({ msg, setMsg }: { msg: ReturnType<typeof useState<{ text: string; tone: 'success' | 'error' | 'info' } | null>>[0]; setMsg: (m: { text: string; tone: 'success' | 'error' | 'info' } | null) => void }) {
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

// ── Banner / Announcement / Info tab ────────────────────────────────────────

type ContentFormState = {
  title: string; body: string; image_url: string;
  cta_label: string; cta_url: string; published: boolean;
};

const emptyForm = (): ContentFormState => ({
  title: '', body: '', image_url: '', cta_label: '', cta_url: '', published: true,
});

function ContentTab({
  contentType, setMsg,
}: {
  contentType: WebsiteContentType;
  setMsg: (m: { text: string; tone: 'success' | 'error' | 'info' } | null) => void;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  const [items, setItems] = useState<WebsiteContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ContentFormState>(emptyForm());
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getWebsiteContent(getAccessToken()!, contentType);
      setItems(res.content);
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [contentType]);

  useEffect(() => { void load(); }, [load]);

  const field = (key: keyof ContentFormState) => (v: string | boolean) =>
    setForm(f => ({ ...f, [key]: v }));

  const handleSave = async () => {
    if (!form.title.trim()) {
      setMsg({ text: 'Title is required.', tone: 'error' });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const data = {
        title: form.title.trim(),
        body: form.body.trim() || undefined,
        image_url: form.image_url.trim() || undefined,
        cta_label: form.cta_label.trim() || undefined,
        cta_url: form.cta_url.trim() || undefined,
        published: form.published,
      };
      if (editId) {
        await updateWebsiteContent(getAccessToken()!, editId, data);
        setMsg({ text: 'Updated.', tone: 'success' });
      } else {
        await createWebsiteContent(getAccessToken()!, { type: contentType, ...data });
        setMsg({ text: 'Saved — it will show on the website.', tone: 'success' });
      }
      setForm(emptyForm());
      setEditId(null);
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (item: WebsiteContent) => {
    setEditId(item.id);
    setForm({
      title: item.title,
      body: item.body ?? '',
      image_url: item.image_url ?? '',
      cta_label: item.cta_label ?? '',
      cta_url: item.cta_url ?? '',
      published: item.published,
    });
  };

  const cancelEdit = () => { setEditId(null); setForm(emptyForm()); };

  const handleDelete = async (id: string) => {
    setBusy(true); setMsg(null);
    try {
      await deleteWebsiteContent(getAccessToken()!, id);
      if (editId === id) { setEditId(null); setForm(emptyForm()); }
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const isBanner = contentType === 'banner';
  const addLabel = { banner: 'Add banner', announcement: 'Add announcement', info: 'Add info block' }[contentType];
  const saveLabel = editId ? 'Update' : { banner: 'Save banner', announcement: 'Save announcement', info: 'Save info block' }[contentType];

  return (
    <>
      <SectionLabel>{editId ? 'Edit' : addLabel}</SectionLabel>
      <GroupedCard>
        <FieldRow label="Title" displayValue={form.title}>
          <TextInput value={form.title} onChangeText={field('title')}
            placeholder={contentType === 'info' ? 'e.g. Opening Hours' : 'Title'}
            placeholderTextColor={t.color.textMuted} style={s.input} />
        </FieldRow>
        <FieldRow label="Body" displayValue={form.body ? form.body.slice(0, 40) + (form.body.length > 40 ? '…' : '') : ''}>
          <TextInput value={form.body} onChangeText={field('body')} multiline
            placeholder="Content (optional)"
            placeholderTextColor={t.color.textMuted} style={s.inputMulti} />
        </FieldRow>
        {isBanner && (
          <>
            <FieldRow label="Image URL" displayValue={form.image_url ? '(set)' : ''}>
              <TextInput value={form.image_url} onChangeText={field('image_url')}
                placeholder="https://…" placeholderTextColor={t.color.textMuted}
                autoCapitalize="none" style={s.input} />
            </FieldRow>
            <FieldRow label="Button label" displayValue={form.cta_label}>
              <TextInput value={form.cta_label} onChangeText={field('cta_label')}
                placeholder="e.g. Shop now" placeholderTextColor={t.color.textMuted} style={s.input} />
            </FieldRow>
            <FieldRow label="Button URL" displayValue={form.cta_url ? '(set)' : ''}>
              <TextInput value={form.cta_url} onChangeText={field('cta_url')}
                placeholder="https://…" placeholderTextColor={t.color.textMuted}
                autoCapitalize="none" style={s.input} />
            </FieldRow>
          </>
        )}
        <GRow last>
          <View style={s.switchRow}>
            <Text variant="label">Published</Text>
            <Switch
              value={form.published}
              onValueChange={field('published')}
              trackColor={{ true: t.color.primary }}
            />
          </View>
        </GRow>
      </GroupedCard>
      <View style={{ flexDirection: 'row', gap: t.space.sm }}>
        <View style={{ flex: 1 }}>
          <Button label={saveLabel} onPress={handleSave} loading={busy} />
        </View>
        {editId && (
          <Button label="Cancel" onPress={cancelEdit} variant="secondary" />
        )}
      </View>

      <SectionLabel right={!loading ? <Text variant="small" muted>{items.length} item{items.length !== 1 ? 's' : ''}</Text> : undefined}>
        {{ banner: 'Banners', announcement: 'Announcements', info: 'Info blocks' }[contentType]}
      </SectionLabel>
      <GroupedCard>
        {loading ? (
          <GRow last><Text variant="label" muted style={{ flex: 1 }}>Loading…</Text></GRow>
        ) : items.length === 0 ? (
          <GRow last><Text variant="label" muted style={{ flex: 1 }}>Nothing here yet.</Text></GRow>
        ) : (
          items.map((item, i) => (
            <GRow key={item.id} last={i === items.length - 1}>
              <View style={s.itemRow}>
                <Text variant="label">{item.title}</Text>
                {!!item.body && <Text variant="small" muted numberOfLines={1}>{item.body}</Text>}
                <View style={s.badge(item.published)}>
                  <Text variant="small" color={item.published ? t.color.success : t.color.textMuted}>
                    {item.published ? 'Published' : 'Draft'}
                  </Text>
                </View>
              </View>
              <View style={s.rowActions}>
                <Pressable onPress={() => startEdit(item)} disabled={busy}
                  accessibilityRole="button" accessibilityLabel="Edit"
                  style={s.iconBtn(busy)}>
                  <Ionicons name="pencil-outline" size={18} color={t.color.textMuted} />
                </Pressable>
                <Pressable onPress={() => handleDelete(item.id)} disabled={busy}
                  accessibilityRole="button" accessibilityLabel="Delete"
                  style={s.iconBtn(busy)}>
                  <Ionicons name="trash-outline" size={18} color={t.color.danger} />
                </Pressable>
              </View>
            </GRow>
          ))
        )}
      </GroupedCard>
    </>
  );
}

// ── Root screen ──────────────────────────────────────────────────────────────

export default function Website() {
  const t = useTheme();
  const s = makeStyles(t);
  const [tab, setTab] = useState<Tab>('events');
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' | 'info' } | null>(null);

  return (
    <Screen toast={msg} onDismissToast={() => setMsg(null)}>
      <View style={s.tabRow}>
        {(['events', 'banners', 'announcements', 'info'] as Tab[]).map((tabKey) => (
          <Pill key={tabKey} label={{ events: 'Events', banners: 'Banners', announcements: 'Announcements', info: 'Info' }[tabKey]}
            active={tab === tabKey} onPress={() => setTab(tabKey)} size="sm" />
        ))}
      </View>

      {tab === 'events' && <EventsTab msg={msg} setMsg={setMsg} />}
      {tab !== 'events' && <ContentTab contentType={TAB_CONTENT_TYPE[tab]} setMsg={setMsg} />}
    </Screen>
  );
}
