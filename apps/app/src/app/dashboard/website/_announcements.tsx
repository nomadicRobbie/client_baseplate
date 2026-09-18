import { useEffect, useState, useCallback } from 'react';
import { View, Pressable, TextInput, Switch, Image, ActivityIndicator, useWindowDimensions, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAccessToken } from '@/lib/session';
import {
  getWebsiteContent, createWebsiteContent, updateWebsiteContent, deleteWebsiteContent,
  uploadProductImage,
  type WebsiteContent, type AnnouncementStyle,
} from '@/lib/api';
import { useImageSlots, type UploadFn } from '@/lib/image-slots';
import { Text, Button, GroupedCard, FieldRow, GRow, SectionLabel, Pill } from '@/ui/components';
import { useTheme } from '@/theme';
import { useProfile } from '@/lib/profile-context';
import {
  makeStyles, BG_TOKENS, OPACITY_OPTIONS, LAYOUTS, MODAL_SIZES,
  FALLBACK_PAGES, toPageOptions, resolveToken,
  ColorSwatchPicker, LayoutThumb, SizeThumb, CtaUrlPicker,
  type ToastMsg,
} from './_shared';

// ── Announcement preview modal ────────────────────────────────────────────────

function AnnouncementPreview({
  form, imageUri, org,
}: {
  form: { title: string; body: string; cta_label: string; style: AnnouncementStyle };
  imageUri: string | null;
  org: { brand_color: string | null; accent_color: string | null } | null | undefined;
}) {
  const { width, height } = useWindowDimensions();
  const [visible, setVisible] = useState(false);

  const sizeFraction = form.style.modal_size === 'sm' ? 0.55 : form.style.modal_size === 'md' ? 0.72 : 0.92;
  const modalW = Math.min(width * sizeFraction, form.style.modal_size === 'sm' ? 360 : form.style.modal_size === 'md' ? 480 : 680);
  const modalH = modalW * 0.7;

  const bgHex = resolveToken(
    form.style.bg_token,
    org,
    BG_TOKENS.find(b => b.token === form.style.bg_token)?.fallback ?? '#ffffff',
  );

  const r = parseInt(bgHex.slice(1, 3), 16) / 255;
  const g = parseInt(bgHex.slice(3, 5), 16) / 255;
  const b = parseInt(bgHex.slice(5, 7), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const textColor  = lum > 0.4 ? '#0e0e0e' : '#ffffff';
  const mutedColor = lum > 0.4 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.6)';
  const btnBg      = lum > 0.4 ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)';
  const btnText    = lum > 0.4 ? '#ffffff' : '#0e0e0e';

  const isLeft  = form.style.layout === 'split-left';
  const isRight = form.style.layout === 'split-right';
  const isSplit = isLeft || isRight;
  const imgW    = modalW * 0.42;

  const textBlock = (
    <View style={{ flex: 1, padding: 20, justifyContent: 'center' as const }}>
      <Text variant="label" numberOfLines={2} style={{ color: textColor, fontSize: 16, fontWeight: '700' as const, marginBottom: 6 }}>
        {form.title || 'Your heading'}
      </Text>
      {!!form.body && (
        <Text variant="small" numberOfLines={4} style={{ color: mutedColor, fontSize: 13, lineHeight: 18, marginBottom: 14 }}>
          {form.body}
        </Text>
      )}
      {!!form.cta_label && (
        <View style={{ alignSelf: 'flex-start' as const, backgroundColor: btnBg, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 16 }}>
          <Text variant="small" style={{ color: btnText, fontSize: 13, fontWeight: '600' as const }}>{form.cta_label}</Text>
        </View>
      )}
    </View>
  );

  const imgBlock = imageUri ? (
    <Image source={{ uri: imageUri }} style={{ width: imgW, height: modalH }} resizeMode="cover" />
  ) : (
    <View style={{ width: imgW, height: modalH, backgroundColor: 'rgba(0,0,0,0.1)', alignItems: 'center' as const, justifyContent: 'center' as const }}>
      <Ionicons name="image-outline" size={32} color={mutedColor} />
    </View>
  );

  return (
    <>
      <Button label="Preview" onPress={() => setVisible(true)} variant="secondary" />

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        {/* full-screen backdrop — tapping outside closes */}
        <Pressable
          style={{ flex: 1, backgroundColor: `rgba(0,0,0,${form.style.overlay_opacity})`, alignItems: 'center' as const, justifyContent: 'center' as const }}
          onPress={() => setVisible(false)}
        >
          {/* modal card — stop press propagation so tapping inside doesn't close */}
          <Pressable
            style={{ width: modalW, borderRadius: 12, backgroundColor: bgHex, overflow: 'hidden' as const, flexDirection: isSplit ? 'row' as const : 'column' as const }}
            onPress={(e) => e.stopPropagation()}
          >
            {isLeft && imgBlock}
            {!isSplit ? (
              <>
                {imageUri && <Image source={{ uri: imageUri }} style={{ width: '100%', height: modalH * 0.45 }} resizeMode="cover" />}
                {textBlock}
              </>
            ) : textBlock}
            {isRight && imgBlock}

            {/* close button */}
            <Pressable
              onPress={() => setVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="Close preview"
              style={{ position: 'absolute' as const, top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 20, padding: 4 }}
            >
              <Ionicons name="close" size={18} color="#fff" />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

type AnnouncementForm = {
  title: string; body: string; image_url: string; cta_label: string; cta_url: string;
  published: boolean; style: AnnouncementStyle;
};

const defaultAnnouncementForm = (): AnnouncementForm => ({
  title: '', body: '', image_url: '', cta_label: '', cta_url: '', published: true,
  style: { layout: 'centered', modal_size: 'md', bg_token: 'surface', overlay_opacity: 0.5 },
});

export function AnnouncementTab({ setMsg }: { setMsg: (m: ToastMsg | null) => void }) {
  const t = useTheme();
  const s = makeStyles(t);
  const { data } = useProfile();
  const org = data?.org;
  const pages = toPageOptions(org?.website_pages?.length ? org.website_pages : FALLBACK_PAGES);

  const tok = () => getAccessToken()!;
  const uploadFn: UploadFn = (f) => uploadProductImage(tok(), f);
  const { slots, pick, retrySlot, doneUrls, isUploading, reset: resetSlots } = useImageSlots(
    [],
    (msg) => setMsg({ text: msg, tone: 'error' }),
  );

  const [items, setItems] = useState<WebsiteContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<AnnouncementForm>(defaultAnnouncementForm());
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getWebsiteContent(getAccessToken()!, 'announcement');
      setItems(res.content);
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof AnnouncementForm>(key: K, val: AnnouncementForm[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  const setStyle = (patch: Partial<AnnouncementStyle>) =>
    setForm(f => ({ ...f, style: { ...f.style, ...patch } }));

  const handleSave = async () => {
    if (!form.title.trim()) { setMsg({ text: 'Heading is required.', tone: 'error' }); return; }
    setBusy(true); setMsg(null);
    try {
      const payload = {
        title: form.title.trim(),
        body: form.body.trim() || undefined,
        // prefer newly uploaded; fall back to existing url when editing without re-uploading
        image_url: doneUrls[0] ?? (form.image_url || undefined),
        cta_label: form.cta_label.trim() || undefined,
        cta_url: form.cta_url.trim() || undefined,
        published: form.published,
        style: form.style,
      };
      if (editId) {
        await updateWebsiteContent(getAccessToken()!, editId, payload);
        setMsg({ text: 'Announcement updated.', tone: 'success' });
      } else {
        await createWebsiteContent(getAccessToken()!, { type: 'announcement', ...payload });
        setMsg({ text: 'Announcement saved.', tone: 'success' });
      }
      setForm(defaultAnnouncementForm()); setEditId(null); resetSlots();
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (item: WebsiteContent) => {
    setEditId(item.id);
    resetSlots(item.image_url ? [item.image_url] : []);
    const st = item.style as AnnouncementStyle | null;
    setForm({
      title: item.title, body: item.body ?? '', image_url: item.image_url ?? '',
      cta_label: item.cta_label ?? '', cta_url: item.cta_url ?? '',
      published: item.published,
      style: {
        layout:          st?.layout          ?? 'centered',
        modal_size:      st?.modal_size      ?? 'md',
        bg_token:        st?.bg_token        ?? 'surface',
        overlay_opacity: st?.overlay_opacity ?? 0.5,
      },
    });
  };

  const handleDelete = async (id: string) => {
    setBusy(true); setMsg(null);
    try {
      await deleteWebsiteContent(getAccessToken()!, id);
      if (editId === id) { setEditId(null); setForm(defaultAnnouncementForm()); resetSlots(); }
      await load();
    } catch (e) {
      setMsg({ text: String(e instanceof Error ? e.message : e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionLabel>{editId ? 'Edit announcement' : 'Add announcement'}</SectionLabel>

      <SectionLabel>Content</SectionLabel>
      <GroupedCard>
        <FieldRow label="Heading" displayValue={form.title}>
          <TextInput value={form.title} onChangeText={v => set('title', v)}
            placeholder="e.g. Welcome back!"
            placeholderTextColor={t.color.textMuted} style={s.input} />
        </FieldRow>
        <FieldRow label="Body" displayValue={form.body ? form.body.slice(0, 40) + (form.body.length > 40 ? '…' : '') : ''}>
          <TextInput value={form.body} onChangeText={v => set('body', v)} multiline
            placeholder="Supporting text (optional)"
            placeholderTextColor={t.color.textMuted} style={s.inputMulti} />
        </FieldRow>
        <GRow>
          <View style={s.itemRow}>
            <Text variant="label">Image</Text>
            <Text variant="small" muted>Optional — used in split layouts</Text>
            <View style={[s.pillRow, { marginTop: t.space.sm }]}>
            {slots.map(slot => (
              <Pressable key={slot.id} onPress={slot.status === 'error' ? () => retrySlot(slot.id, uploadFn) : undefined}
                style={s.imageSlot}>
                <Image source={{ uri: slot.localUri }} style={s.imageThumb} resizeMode="cover" />
                {slot.status === 'uploading' && (
                  <View style={s.imageOverlay}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                )}
                {slot.status === 'error' && (
                  <View style={s.imageOverlay}>
                    <Ionicons name="refresh" size={20} color="#fff" />
                  </View>
                )}
              </Pressable>
            ))}
            {slots.length === 0 && form.image_url ? (
              <Pressable onPress={() => void pick(uploadFn, (msg) => setMsg({ text: msg, tone: 'error' }))}
                accessibilityRole="button" accessibilityLabel="Replace image" style={s.imageSlot}>
                <Image source={{ uri: form.image_url }} style={s.imageThumb} resizeMode="cover" />
              </Pressable>
            ) : slots.length === 0 ? (
              <Pressable onPress={() => void pick(uploadFn, (msg) => setMsg({ text: msg, tone: 'error' }))}
                accessibilityRole="button" accessibilityLabel="Add image" style={s.imageAdd}>
                <Ionicons name="add" size={28} color={t.color.textMuted} />
              </Pressable>
            ) : null}
            </View>
          </View>
        </GRow>
        <FieldRow label="Button label" displayValue={form.cta_label}>
          <TextInput value={form.cta_label} onChangeText={v => set('cta_label', v)}
            placeholder="e.g. Learn more (optional)"
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

      <SectionLabel>Design</SectionLabel>
      <GroupedCard>
        <GRow>
          <View style={s.itemRow}>
            <Text variant="label">Layout</Text>
            <Text variant="small" muted>How the modal is arranged</Text>
            <View style={[s.layoutRow, { marginTop: t.space.sm }]}>
              {LAYOUTS.map(opt => (
                <Pressable key={opt.value} onPress={() => setStyle({ layout: opt.value })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: form.style.layout === opt.value }}
                  style={s.layoutCard(form.style.layout === opt.value)}>
                  <LayoutThumb layout={opt.value} />
                  <Text variant="small" style={s.layoutLabel}
                    color={form.style.layout === opt.value ? t.color.primary : t.color.textMuted}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </GRow>
        <GRow>
          <View style={s.itemRow}>
            <Text variant="label">Size</Text>
            <Text variant="small" muted>How much of the screen the modal fills</Text>
            <View style={[s.layoutRow, { marginTop: t.space.sm }]}>
              {MODAL_SIZES.map(opt => (
                <Pressable key={opt.value} onPress={() => setStyle({ modal_size: opt.value })}
                  accessibilityRole="button"
                  accessibilityState={{ selected: form.style.modal_size === opt.value }}
                  style={s.layoutCard(form.style.modal_size === opt.value)}>
                  <SizeThumb size={opt.value} />
                  <Text variant="small" style={s.layoutLabel}
                    color={form.style.modal_size === opt.value ? t.color.primary : t.color.textMuted}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </GRow>
        <GRow>
          <View style={s.itemRow}>
            <Text variant="label">Background</Text>
            <Text variant="small" muted>Modal background colour</Text>
            <View style={{ marginTop: t.space.sm }}>
              <ColorSwatchPicker
                options={BG_TOKENS.filter(o => ['surface', 'surfaceAlt', 'primary', 'accent'].includes(o.token))}
                selected={form.style.bg_token}
                onSelect={v => setStyle({ bg_token: v })}
                org={org}
              />
            </View>
          </View>
        </GRow>
        <GRow last>
          <View style={s.itemRow}>
            <Text variant="label">Overlay</Text>
            <Text variant="small" muted>How much to dim the page behind</Text>
            <View style={[s.pillRow, { marginTop: t.space.sm }]}>
              {OPACITY_OPTIONS.map(opt => (
                <Pill key={opt.value} label={opt.label} size="sm"
                  active={form.style.overlay_opacity === opt.value}
                  onPress={() => setStyle({ overlay_opacity: opt.value })} />
              ))}
            </View>
          </View>
        </GRow>
      </GroupedCard>

      <View style={s.btnRow}>
        <View style={s.btnFlex}>
          <AnnouncementPreview
            form={form}
            imageUri={doneUrls[0] ?? (form.image_url || null)}
            org={org}
          />
        </View>
        <View style={s.btnFlex}>
          <Button label={editId ? 'Update announcement' : 'Save announcement'} onPress={handleSave} loading={busy} />
        </View>
        {editId && <Button label="Cancel" onPress={() => { setEditId(null); setForm(defaultAnnouncementForm()); resetSlots(); }} variant="secondary" />}
      </View>

      <SectionLabel right={!loading ? <Text variant="small" muted>{items.length}</Text> : undefined}>
        Announcements
      </SectionLabel>
      <Text variant="small" muted>
        Shown as a modal when a visitor navigates to their second page in a session.
      </Text>
      <GroupedCard>
        {loading ? (
          <GRow last><Text variant="label" muted style={{ flex: 1 }}>Loading…</Text></GRow>
        ) : items.length === 0 ? (
          <GRow last><Text variant="label" muted style={{ flex: 1 }}>No announcements yet.</Text></GRow>
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
