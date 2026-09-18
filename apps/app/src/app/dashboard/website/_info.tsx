import { useEffect, useState, useCallback } from 'react';
import { View, Pressable, TextInput, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAccessToken } from '@/lib/session';
import {
  getWebsiteContent, createWebsiteContent, updateWebsiteContent, deleteWebsiteContent,
  type WebsiteContent,
} from '@/lib/api';
import { Text, Button, GroupedCard, FieldRow, GRow, SectionLabel } from '@/ui/components';
import { useTheme } from '@/theme';
import { makeStyles, type ToastMsg } from './_shared';

type InfoForm = { title: string; body: string; published: boolean };
const defaultInfoForm = (): InfoForm => ({ title: '', body: '', published: true });

export function InfoTab({ setMsg }: { setMsg: (m: ToastMsg | null) => void }) {
  const t = useTheme();
  const s = makeStyles(t);
  const [items, setItems] = useState<WebsiteContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<InfoForm>(defaultInfoForm());
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getWebsiteContent(getAccessToken()!, 'info');
      setItems(res.content);
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof InfoForm>(key: K, val: InfoForm[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  const handleSave = async () => {
    if (!form.title.trim()) { setMsg({ text: 'Title is required.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    try {
      const payload = { title: form.title.trim(), body: form.body.trim() || undefined, published: form.published };
      if (editId) {
        await updateWebsiteContent(getAccessToken()!, editId, payload);
        setMsg({ text: 'Updated.', tone: 'success' });
      } else {
        await createWebsiteContent(getAccessToken()!, { type: 'info', ...payload });
        setMsg({ text: 'Info block saved.', tone: 'success' });
      }
      setForm(defaultInfoForm()); setEditId(null);
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (item: WebsiteContent) => {
    setEditId(item.id);
    setForm({ title: item.title, body: item.body ?? '', published: item.published });
  };

  const handleDelete = async (id: string) => {
    setBusy(true); setMsg(null);
    try {
      await deleteWebsiteContent(getAccessToken()!, id);
      if (editId === id) { setEditId(null); setForm(defaultInfoForm()); }
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionLabel>{editId ? 'Edit info block' : 'Add info block'}</SectionLabel>
      <GroupedCard>
        <FieldRow label="Label" displayValue={form.title}>
          <TextInput value={form.title} onChangeText={v => set('title', v)}
            placeholder="e.g. Opening Hours"
            placeholderTextColor={t.color.textMuted} style={s.input} />
        </FieldRow>
        <FieldRow label="Content" displayValue={form.body ? form.body.slice(0, 40) + (form.body.length > 40 ? '…' : '') : ''}>
          <TextInput value={form.body} onChangeText={v => set('body', v)} multiline
            placeholder="Content…" placeholderTextColor={t.color.textMuted} style={s.inputMulti} />
        </FieldRow>
        <GRow last>
          <View style={s.switchRow}>
            <Text variant="label">Published</Text>
            <Switch value={form.published} onValueChange={v => set('published', v)}
              trackColor={{ true: t.color.primary }} />
          </View>
        </GRow>
      </GroupedCard>
      <View style={s.btnRow}>
        <View style={s.btnFlex}>
          <Button label={editId ? 'Update' : 'Save info block'} onPress={handleSave} loading={busy} />
        </View>
        {editId && <Button label="Cancel" onPress={() => { setEditId(null); setForm(defaultInfoForm()); }} variant="secondary" />}
      </View>
      <SectionLabel right={!loading ? <Text variant="small" muted>{items.length}</Text> : undefined}>
        Info blocks
      </SectionLabel>
      <GroupedCard>
        {loading ? (
          <GRow last><Text variant="label" muted style={{ flex: 1 }}>Loading…</Text></GRow>
        ) : items.length === 0 ? (
          <GRow last><Text variant="label" muted style={{ flex: 1 }}>No info blocks yet.</Text></GRow>
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
                  accessibilityRole="button" accessibilityLabel="Edit" style={s.iconBtn(busy)}>
                  <Ionicons name="pencil-outline" size={18} color={t.color.textMuted} />
                </Pressable>
                <Pressable onPress={() => handleDelete(item.id)} disabled={busy}
                  accessibilityRole="button" accessibilityLabel="Delete" style={s.iconBtn(busy)}>
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
