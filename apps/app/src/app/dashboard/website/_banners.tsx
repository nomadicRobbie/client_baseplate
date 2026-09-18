import { useEffect, useState, useCallback } from 'react';
import { View, Pressable, TextInput, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAccessToken } from '@/lib/session';
import {
  getWebsiteContent, createWebsiteContent, updateWebsiteContent, deleteWebsiteContent,
  type WebsiteContent, type BannerStyle,
} from '@/lib/api';
import { Text, Button, GroupedCard, FieldRow, GRow, SectionLabel, Pill } from '@/ui/components';
import { useTheme } from '@/theme';
import { useProfile } from '@/lib/profile-context';
import {
  makeStyles, BG_TOKENS, TEXT_TOKENS, FONT_TOKENS,
  FALLBACK_PAGES, toPageOptions,
  ColorSwatchPicker, CtaUrlPicker,
  type ToastMsg,
} from './_shared';

type BannerForm = {
  title: string; cta_label: string; cta_url: string; published: boolean;
  page_targets: string[]; style: BannerStyle;
};

const defaultBannerForm = (): BannerForm => ({
  title: '', cta_label: '', cta_url: '', published: true,
  page_targets: ['*'],
  style: { bg_token: 'primary', text_token: 'primaryText', font_token: 'heading' },
});

export function BannerTab({ setMsg }: { setMsg: (m: ToastMsg | null) => void }) {
  const t = useTheme();
  const s = makeStyles(t);
  const { data } = useProfile();
  const org = data?.org;
  const pages = toPageOptions(org?.website_pages?.length ? org.website_pages : FALLBACK_PAGES);

  const [items, setItems] = useState<WebsiteContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<BannerForm>(defaultBannerForm());
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getWebsiteContent(getAccessToken()!, 'banner');
      setItems(res.content);
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof BannerForm>(key: K, val: BannerForm[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  const setStyle = (patch: Partial<BannerStyle>) =>
    setForm(f => ({ ...f, style: { ...f.style, ...patch } }));

  const togglePage = (path: string) => {
    if (path === '*') { set('page_targets', ['*']); return; }
    setForm(f => {
      const without = f.page_targets.filter(p => p !== '*' && p !== path);
      const has = f.page_targets.includes(path);
      return { ...f, page_targets: has ? without : [...without, path] };
    });
  };

  const handleSave = async () => {
    if (!form.title.trim()) { setMsg({ text: 'Title is required.', tone: 'error' }); return; }
    if (!form.page_targets.length) { setMsg({ text: 'Select at least one page.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    try {
      const payload = {
        title: form.title.trim(),
        cta_label: form.cta_label.trim() || undefined,
        cta_url: form.cta_url.trim() || undefined,
        published: form.published,
        page_targets: form.page_targets,
        style: form.style,
      };
      if (editId) {
        await updateWebsiteContent(getAccessToken()!, editId, payload);
        setMsg({ text: 'Banner updated.', tone: 'success' });
      } else {
        await createWebsiteContent(getAccessToken()!, { type: 'banner', ...payload });
        setMsg({ text: 'Banner saved — it will appear on the website.', tone: 'success' });
      }
      setForm(defaultBannerForm()); setEditId(null);
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (item: WebsiteContent) => {
    setEditId(item.id);
    const st = item.style as BannerStyle | null;
    setForm({
      title: item.title, cta_label: item.cta_label ?? '', cta_url: item.cta_url ?? '',
      published: item.published, page_targets: item.page_targets ?? ['*'],
      style: { bg_token: st?.bg_token ?? 'primary', text_token: st?.text_token ?? 'primaryText', font_token: st?.font_token ?? 'heading' },
    });
  };

  const handleDelete = async (id: string) => {
    setBusy(true); setMsg(null);
    try {
      await deleteWebsiteContent(getAccessToken()!, id);
      if (editId === id) { setEditId(null); setForm(defaultBannerForm()); }
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionLabel>{editId ? 'Edit banner' : 'Add banner'}</SectionLabel>
      <GroupedCard>
        <FieldRow label="Text" displayValue={form.title}>
          <TextInput value={form.title} onChangeText={v => set('title', v)}
            placeholder="e.g. Free shipping this weekend"
            placeholderTextColor={t.color.textMuted} style={s.input} />
        </FieldRow>
        <FieldRow label="Button label" displayValue={form.cta_label}>
          <TextInput value={form.cta_label} onChangeText={v => set('cta_label', v)}
            placeholder="e.g. Shop now (optional)"
            placeholderTextColor={t.color.textMuted} style={s.input} />
        </FieldRow>
        <FieldRow label="Button URL" displayValue={form.cta_url ? '(set)' : ''}>
          <CtaUrlPicker value={form.cta_url} onChange={v => set('cta_url', v)} pages={pages} />
        </FieldRow>
        <GRow last>
          <View style={s.switchRow}>
            <Text variant="label">Published</Text>
            <Switch value={form.published} onValueChange={v => set('published', v)}
              trackColor={{ true: t.color.primary }} />
          </View>
        </GRow>
      </GroupedCard>

      <SectionLabel>Pages</SectionLabel>
      <GroupedCard>
        <GRow last>
          <View style={s.pillRow}>
            {pages.map(p => (
              <Pill key={p.path} label={p.label} size="sm"
                active={form.page_targets.includes(p.path) || (p.path !== '*' && form.page_targets.includes('*'))}
                onPress={() => togglePage(p.path)} />
            ))}
          </View>
        </GRow>
      </GroupedCard>

      <SectionLabel>Style</SectionLabel>
      <GroupedCard>
        <GRow>
          <View style={s.itemRow}>
            <Text variant="label">Background</Text>
            <Text variant="small" muted>Uses your brand colours</Text>
          </View>
        </GRow>
        <GRow>
          <ColorSwatchPicker options={BG_TOKENS} selected={form.style.bg_token}
            onSelect={v => setStyle({ bg_token: v })} org={org} />
        </GRow>
        <GRow>
          <Text variant="label">Text colour</Text>
        </GRow>
        <GRow>
          <View style={s.pillRow}>
            {TEXT_TOKENS.map(opt => (
              <Pill key={opt.token} label={opt.label} size="sm"
                active={form.style.text_token === opt.token}
                onPress={() => setStyle({ text_token: opt.token })} />
            ))}
          </View>
        </GRow>
        <GRow last>
          <Text variant="label">Font</Text>
        </GRow>
        <GRow last>
          <View style={s.pillRow}>
            {FONT_TOKENS.map(opt => (
              <Pill key={opt.token} label={opt.label} size="sm"
                active={form.style.font_token === opt.token}
                onPress={() => setStyle({ font_token: opt.token })} />
            ))}
          </View>
        </GRow>
      </GroupedCard>

      <View style={s.btnRow}>
        <View style={s.btnFlex}>
          <Button label={editId ? 'Update banner' : 'Save banner'} onPress={handleSave} loading={busy} />
        </View>
        {editId && <Button label="Cancel" onPress={() => { setEditId(null); setForm(defaultBannerForm()); }} variant="secondary" />}
      </View>

      <SectionLabel right={!loading ? <Text variant="small" muted>{items.length}</Text> : undefined}>
        Banners
      </SectionLabel>
      <GroupedCard>
        {loading ? (
          <GRow last><Text variant="label" muted style={{ flex: 1 }}>Loading…</Text></GRow>
        ) : items.length === 0 ? (
          <GRow last><Text variant="label" muted style={{ flex: 1 }}>No banners yet.</Text></GRow>
        ) : (
          items.map((item, i) => (
            <GRow key={item.id} last={i === items.length - 1}>
              <View style={s.itemRow}>
                <Text variant="label">{item.title}</Text>
                <Text variant="small" muted>
                  {(item.page_targets ?? ['*']).includes('*') ? 'All pages' : (item.page_targets ?? []).join(', ')}
                </Text>
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
