import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Pressable, Image, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type {
  Product, ProductVariant, ProductContent, ProductMedia, ProductSpecifications,
  ProductShippingInfo, ProductOrganisation, ProductSeo, ProductSocialProof,
  ProductPricingMeta, ProductCompliance, ProductVariantOptions, ProductStockStatus,
  ProductStatus, ProductVisibility, ProductType,
} from '@blnk/shared';
import { getAccessToken } from '@/lib/session';
import {
  getAdminProduct, updateProduct, uploadProductImage,
  listProductVariants, createVariant, updateVariant, deleteVariant,
} from '@/lib/api';
import { useImageSlots, type UploadFn, type ImageSlot } from '@/lib/image-slots';
import { Screen, Text, Card, Button, Toggle, Pill, GroupedCard, FieldRow, SectionLabel, Badge, TextField } from '@/ui/components';
import { DateField } from '@/ui/date-field';
import { useTheme } from '@/theme';
import { useProfile } from '@/lib/profile-context';

// ── Helpers ───────────────────────────────────────────────────────────────────
const tok = () => getAccessToken()!;
const fmt = (cents: number | null) => cents != null ? (cents / 100).toFixed(2) : '';
const toCents = (s: string) => { const n = parseFloat(s); return isNaN(n) ? null : Math.round(n * 100); };
const toArr = (s: string): string[] => s.split(',').map(x => x.trim()).filter(Boolean);
const fromArr = (a?: string[] | null): string => (a ?? []).join(', ');
const toNum = (s: string): number | null => { const n = parseInt(s, 10); return isNaN(n) ? null : n; };
const toFloat = (s: string): number | null => { const n = parseFloat(s); return isNaN(n) ? null : n; };

function stockBadge(s: ProductStockStatus): 'success' | 'accent' | 'neutral' {
  if (s === 'in_stock') return 'success';
  if (s === 'low_stock') return 'accent';
  return 'neutral';
}

// ── PillSelect ────────────────────────────────────────────────────────────────
function PillSelect<T extends string>({ options, value, onChange }: { options: T[]; value: T; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
      {options.map(o => <Pill key={o} label={o} active={value === o} onPress={() => onChange(o)} />)}
    </View>
  );
}

// ── Image row ─────────────────────────────────────────────────────────────────
function ImageRow({ slots, onAdd, onRetry }: { slots: ImageSlot[]; onAdd: () => void; onRetry: (id: string) => void }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: 80 }}>
      <View style={{ flexDirection: 'row', gap: t.space.sm }}>
        {slots.map(slot => (
          <Pressable key={slot.id} onPress={slot.status === 'error' ? () => onRetry(slot.id) : undefined}
            style={{ width: 80, height: 80, borderRadius: t.radius.md, overflow: 'hidden' }}>
            <Image source={{ uri: slot.localUri }} style={{ width: 80, height: 80 }} resizeMode="cover" />
            {slot.status === 'uploading' && (
              <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' } as never}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            )}
            {slot.status === 'error' && (
              <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(220,38,38,0.6)', alignItems: 'center', justifyContent: 'center' } as never}>
                <Ionicons name="refresh" size={20} color="#fff" />
              </View>
            )}
          </Pressable>
        ))}
        <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel="Add image"
          style={{ width: 80, height: 80, borderRadius: t.radius.md, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="add" size={28} color={t.color.textMuted} />
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ── Variant row ───────────────────────────────────────────────────────────────
function VariantRow({ variant, productId, onUpdated, onDeleted }: {
  variant: ProductVariant; productId: string; onUpdated: (v: ProductVariant) => void; onDeleted: (id: string) => void;
}) {
  const t = useTheme();
  const [open, setOpen]     = useState(false);
  const [draft, setDraft]   = useState(variant);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty]   = useState(false);

  const set = (p: Partial<ProductVariant>) => { setDraft(d => ({ ...d, ...p })); setDirty(true); };

  const save = async () => {
    setSaving(true);
    try {
      const { variant: v } = await updateVariant(tok(), productId, variant.id, draft);
      onUpdated(v); setDirty(false);
    } finally { setSaving(false); }
  };

  const remove = async () => {
    await deleteVariant(tok(), productId, variant.id);
    onDeleted(variant.id);
  };

  const optionLabel = Object.entries(variant.option_values).map(([, v]) => v).join(' / ') || variant.title || variant.sku || 'Variant';

  return (
    <View style={{ borderBottomWidth: 1, borderColor: t.color.border }}>
      <Pressable onPress={() => setOpen(o => !o)}
        style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: t.space.lg, gap: t.space.md }}>
        <View style={{ flex: 1 }}>
          <Text variant="label">{optionLabel}</Text>
          {variant.sku && <Text variant="small" muted>{variant.sku}</Text>}
        </View>
        <Text variant="small" muted>{variant.stock_quantity} stock</Text>
        {variant.price_cents != null && <Text variant="small" muted>${fmt(variant.price_cents)}</Text>}
        <Ionicons name={open ? 'chevron-up' : 'chevron-forward'} size={14} color={t.color.textMuted} />
      </Pressable>
      {open && (
        <View style={{ paddingHorizontal: t.space.lg, paddingBottom: t.space.md, gap: t.space.md }}>
          <TextField label="SKU" value={draft.sku ?? ''} onChangeText={v => set({ sku: v || null })} />
          <TextField label="Title" value={draft.title ?? ''} onChangeText={v => set({ title: v || null })} />
          <TextField label="Price override (leave blank to inherit)" value={fmt(draft.price_cents)} onChangeText={v => set({ price_cents: toCents(v) })} keyboardType="default" />
          <TextField label="Compare-at price" value={fmt(draft.compare_at_price_cents)} onChangeText={v => set({ compare_at_price_cents: toCents(v) })} keyboardType="default" />
          <TextField label="Stock quantity" value={String(draft.stock_quantity)} onChangeText={v => set({ stock_quantity: toNum(v) ?? 0 })} keyboardType="number-pad" />
          <TextField label="Warehouse location" value={draft.warehouse_location ?? ''} onChangeText={v => set({ warehouse_location: v || null })} />
          <Toggle value={draft.track_inventory} onChange={v => set({ track_inventory: v })} label="Track inventory" />
          <Toggle value={draft.allow_backorder} onChange={v => set({ allow_backorder: v })} label="Allow backorder" />
          <Toggle value={draft.is_default} onChange={v => set({ is_default: v })} label="Default variant" />
          <Toggle value={draft.active} onChange={v => set({ active: v })} label="Active" />
          <View style={{ flexDirection: 'row', gap: t.space.sm }}>
            <Button label="Save" onPress={save} loading={saving} disabled={!dirty} style={{ flex: 1 }} />
            <Button label="Delete" variant="danger" onPress={remove} />
          </View>
        </View>
      )}
    </View>
  );
}

// ── Add variant form ──────────────────────────────────────────────────────────
function AddVariantForm({ productId, options, onAdded, onCancel }: {
  productId: string; options: Record<string, string[]>; onAdded: (v: ProductVariant) => void; onCancel: () => void;
}) {
  const t = useTheme();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [sku, setSku]           = useState('');
  const [price, setPrice]       = useState('');
  const [stock, setStock]       = useState('0');
  const [saving, setSaving]     = useState(false);

  const toggle = (dim: string, val: string) =>
    setSelected(s => ({ ...s, [dim]: s[dim] === val ? '' : val }));

  const submit = async () => {
    setSaving(true);
    try {
      const { variant } = await createVariant(tok(), productId, {
        sku: sku || null,
        title: Object.values(selected).filter(Boolean).join(' / ') || null,
        option_values: selected,
        price_cents: toCents(price),
        compare_at_price_cents: null, cost_price_cents: null,
        stock_quantity: toNum(stock) ?? 0,
        stock_status: 'in_stock' as const,
        track_inventory: true, allow_backorder: false,
        low_stock_threshold: null, warehouse_location: null,
        image_id: null, weight_grams: null, is_default: false, active: true,
      });
      onAdded(variant);
    } finally { setSaving(false); }
  };

  return (
    <View style={{ paddingHorizontal: t.space.lg, paddingVertical: t.space.md, gap: t.space.md }}>
      {Object.entries(options).map(([dim, vals]) => (
        <View key={dim} style={{ gap: t.space.xs }}>
          <Text variant="label" muted>{dim}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
            {vals.map(v => <Pill key={v} label={v} active={selected[dim] === v} onPress={() => toggle(dim, v)} />)}
          </View>
        </View>
      ))}
      <TextField label="SKU (optional)" value={sku} onChangeText={setSku} />
      <TextField label="Price override (leave blank to inherit)" value={price} onChangeText={setPrice} keyboardType="default" />
      <TextField label="Stock quantity" value={stock} onChangeText={setStock} keyboardType="number-pad" />
      <View style={{ flexDirection: 'row', gap: t.space.sm }}>
        <Button label="Add variant" onPress={submit} loading={saving} style={{ flex: 1 }} />
        <Button label="Cancel" variant="ghost" onPress={onCancel} />
      </View>
    </View>
  );
}

// ── Product detail screen ─────────────────────────────────────────────────────
export default function ProductDetail() {
  const t = useTheme();
  const router = useRouter();
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const { data: profile } = useProfile();
  const currency = profile?.org?.currency ?? process.env.EXPO_PUBLIC_CURRENCY ?? 'NZD';

  const [product, setProduct]     = useState<Product | null>(null);
  const [variants, setVariants]   = useState<ProductVariant[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [draft, setDraft]         = useState<Partial<Product>>({});
  const [dirty, setDirty]         = useState(false);
  const [addingVariant, setAddingVariant] = useState(false);
  const [toast, setToast]         = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ product: p }, { variants: vs }] = await Promise.all([
        getAdminProduct(tok(), productId),
        listProductVariants(tok(), productId),
      ]);
      setProduct(p); setVariants(vs); setDraft({});
    } catch (e) { setToast({ text: e instanceof Error ? e.message : 'Failed to load', tone: 'error' }); }
    finally { setLoading(false); }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  // Merged view: what the user will save
  const p = useMemo(() => ({ ...product, ...draft }) as Product, [product, draft]);

  const set = useCallback((patch: Partial<Product>) => { setDraft(d => ({ ...d, ...patch })); setDirty(true); }, []);
  const setContent   = useCallback((c: Partial<ProductContent>)        => set({ content:       { ...product?.content,       ...draft.content,       ...c } }), [product, draft, set]);
  const setMedia     = useCallback((m: Partial<ProductMedia>)           => set({ media:         { ...product?.media,         ...draft.media,         ...m } }), [product, draft, set]);
  const setSpecs     = useCallback((s: Partial<ProductSpecifications>)  => set({ specifications: { ...product?.specifications, ...draft.specifications, ...s } }), [product, draft, set]);
  const setShipping  = useCallback((s: Partial<ProductShippingInfo>)    => set({ shipping_info:  { ...product?.shipping_info,  ...draft.shipping_info,  ...s } }), [product, draft, set]);
  const setOrg       = useCallback((o: Partial<ProductOrganisation>)    => set({ organisation:   { ...product?.organisation,   ...draft.organisation,   ...o } }), [product, draft, set]);
  const setSeo       = useCallback((s: Partial<ProductSeo>)             => set({ seo:            { ...product?.seo,            ...draft.seo,            ...s } }), [product, draft, set]);
  const setProof     = useCallback((s: Partial<ProductSocialProof>)     => set({ social_proof:   { ...product?.social_proof,   ...draft.social_proof,   ...s } }), [product, draft, set]);
  const setPriceMeta = useCallback((m: Partial<ProductPricingMeta>)     => set({ pricing_meta:   { ...product?.pricing_meta,   ...draft.pricing_meta,   ...m } }), [product, draft, set]);
  const setCompliance = useCallback((c: Partial<ProductCompliance>)     => set({ compliance:     { ...product?.compliance,     ...draft.compliance,     ...c } }), [product, draft, set]);
  const setVariantOpts = useCallback((v: Partial<ProductVariantOptions>) => set({ variant_options: { ...product?.variant_options, ...draft.variant_options, ...v } }), [product, draft, set]);

  const uploadFn: UploadFn = (f) => uploadProductImage(tok(), f);
  const initialImages = useMemo(() => {
    const g = product?.media?.gallery ?? [];
    return g.length ? g : product?.media?.primary_image ? [product.media.primary_image] : [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);
  const { slots, pick, retrySlot, doneUrls, isUploading } = useImageSlots(initialImages, (msg) => setToast({ text: msg, tone: 'error' }));

  const save = async () => {
    setSaving(true);
    try {
      const patch: Partial<Product> = {
        ...draft,
        media: { ...p.media, primary_image: doneUrls[0] ?? null, gallery: doneUrls },
      };
      const { product: updated } = await updateProduct(tok(), productId, patch);
      setProduct(updated); setDraft({}); setDirty(false);
      setToast({ text: 'Saved', tone: 'success' });
    } catch (e) { setToast({ text: e instanceof Error ? e.message : 'Save failed', tone: 'error' }); }
    finally { setSaving(false); }
  };

  if (loading) return (
    <Screen toast={toast} onDismissToast={() => setToast(null)}>
      <ActivityIndicator color={t.color.primary} />
    </Screen>
  );

  if (!product) return (
    <Screen toast={toast} onDismissToast={() => setToast(null)}>
      <Text muted>Product not found.</Text>
    </Screen>
  );

  const variantOptionEntries = Object.entries(p.variant_options?.options ?? {});

  return (
    <Screen toast={toast} onDismissToast={() => setToast(null)}>

      {/* ── Header ── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="chevron-back" size={20} color={t.color.primary} />
          <Text variant="label" color={t.color.primary}>Store</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text variant="heading" numberOfLines={1}>{p.title}</Text>
        </View>
        <Badge label={p.status} tone={p.status === 'active' ? 'success' : 'neutral'} />
        <Button label={saving ? 'Saving…' : 'Save'} onPress={save} loading={saving} disabled={!dirty && !isUploading} />
      </View>

      {/* ── Core ── */}
      <SectionLabel>Core</SectionLabel>
      <GroupedCard>
        <FieldRow label="Title" displayValue={p.title}>
          <TextField value={p.title} onChangeText={v => set({ title: v })} />
        </FieldRow>
        <FieldRow label="Description" displayValue={p.description || '—'}>
          <TextField value={p.description} onChangeText={v => set({ description: v })} multiline />
        </FieldRow>
        <FieldRow label="Status" displayValue={p.status}>
          <PillSelect<ProductStatus> options={['active', 'draft', 'archived']} value={p.status} onChange={v => set({ status: v })} />
        </FieldRow>
        <FieldRow label="Visibility" displayValue={p.visibility}>
          <PillSelect<ProductVisibility> options={['public', 'private', 'password']} value={p.visibility} onChange={v => set({ visibility: v })} />
        </FieldRow>
        <FieldRow label="Type" displayValue={p.product_type}>
          <PillSelect<ProductType> options={['physical', 'digital', 'service']} value={p.product_type} onChange={v => set({ product_type: v })} />
        </FieldRow>
        <View style={{ paddingHorizontal: t.space.lg }}>
          <Toggle value={p.featured} onChange={v => set({ featured: v })} label="Featured" />
          <Toggle value={p.active} onChange={v => set({ active: v })} label="Visible in shop" />
          <Toggle value={p.is_digital} onChange={v => set({ is_digital: v })} label="Digital product" />
        </View>
        <FieldRow label="Published" displayValue={p.published_at ? p.published_at.slice(0, 10) : '—'} last>
          <DateField value={p.published_at?.slice(0, 10) ?? ''} onChange={v => set({ published_at: v ? `${v}T00:00:00Z` : null })} placeholder="Not yet published" />
        </FieldRow>
      </GroupedCard>

      {/* ── Content ── */}
      <SectionLabel>Content</SectionLabel>
      <GroupedCard>
        <FieldRow label="Subtitle" displayValue={p.content?.subtitle || '—'}>
          <TextField value={p.content?.subtitle ?? ''} onChangeText={v => setContent({ subtitle: v || null })} />
        </FieldRow>
        <FieldRow label="Short description" displayValue={p.content?.short_description || '—'}>
          <TextField value={p.content?.short_description ?? ''} onChangeText={v => setContent({ short_description: v || null })} multiline />
        </FieldRow>
        <FieldRow label="Full description (HTML)" displayValue={p.content?.description_html ? '(set)' : '—'}>
          <TextField value={p.content?.description_html ?? ''} onChangeText={v => setContent({ description_html: v || null })} multiline />
        </FieldRow>
        <FieldRow label="Features" displayValue={fromArr(p.content?.features)}>
          <TextField value={fromArr(p.content?.features)} onChangeText={v => setContent({ features: toArr(v) })} placeholder="Comma-separated" />
        </FieldRow>
        <FieldRow label="Care instructions" displayValue={p.content?.care_instructions || '—'}>
          <TextField value={p.content?.care_instructions ?? ''} onChangeText={v => setContent({ care_instructions: v || null })} multiline />
        </FieldRow>
        <FieldRow label="Warranty" displayValue={p.content?.warranty || '—'}>
          <TextField value={p.content?.warranty ?? ''} onChangeText={v => setContent({ warranty: v || null })} />
        </FieldRow>
        <FieldRow label="Included in box" displayValue={fromArr(p.content?.included_in_box)} last>
          <TextField value={fromArr(p.content?.included_in_box)} onChangeText={v => setContent({ included_in_box: toArr(v) })} placeholder="Comma-separated" />
        </FieldRow>
      </GroupedCard>

      {/* ── Media ── */}
      <SectionLabel>Media</SectionLabel>
      <Card>
        <Text variant="label" muted>Images</Text>
        <ImageRow slots={slots} onAdd={() => void pick(uploadFn, (msg) => setToast({ text: msg, tone: 'error' }))} onRetry={(id) => retrySlot(id, uploadFn)} />
      </Card>
      <GroupedCard>
        <FieldRow label="Video URL" displayValue={p.media?.video_url || '—'}>
          <TextField value={p.media?.video_url ?? ''} onChangeText={v => setMedia({ video_url: v || null })} autoCapitalize="none" />
        </FieldRow>
        <FieldRow label="Size chart URL" displayValue={p.media?.size_chart_url || '—'}>
          <TextField value={p.media?.size_chart_url ?? ''} onChangeText={v => setMedia({ size_chart_url: v || null })} autoCapitalize="none" />
        </FieldRow>
        <FieldRow label="Alt text" displayValue={p.media?.alt_text || '—'} last>
          <TextField value={p.media?.alt_text ?? ''} onChangeText={v => setMedia({ alt_text: v || null })} />
        </FieldRow>
      </GroupedCard>

      {/* ── Pricing ── */}
      <SectionLabel>Pricing</SectionLabel>
      <GroupedCard>
        <FieldRow label="Price" displayValue={`${p.currency} ${fmt(p.price_cents)}`}>
          <TextField value={fmt(p.price_cents)} onChangeText={v => set({ price_cents: toCents(v) ?? 0 })} keyboardType="default" />
        </FieldRow>
        <FieldRow label="Compare-at price" displayValue={p.compare_at_price_cents ? `${p.currency} ${fmt(p.compare_at_price_cents)}` : '—'}>
          <TextField value={fmt(p.compare_at_price_cents)} onChangeText={v => set({ compare_at_price_cents: toCents(v) })} keyboardType="default" />
        </FieldRow>
        <FieldRow label="Cost price" displayValue={p.cost_price_cents ? `${p.currency} ${fmt(p.cost_price_cents)}` : '—'}>
          <TextField value={fmt(p.cost_price_cents)} onChangeText={v => set({ cost_price_cents: toCents(v) })} keyboardType="default" />
        </FieldRow>
        <FieldRow label="Currency" displayValue={p.currency}>
          <TextField value={p.currency} onChangeText={v => set({ currency: v.toUpperCase() })} autoCapitalize="none" />
        </FieldRow>
        <FieldRow label="Tax class" displayValue={p.tax_class || '—'}>
          <TextField value={p.tax_class ?? ''} onChangeText={v => set({ tax_class: v || null })} />
        </FieldRow>
        <View style={{ paddingHorizontal: t.space.lg }}>
          <Toggle value={p.tax_inclusive} onChange={v => set({ tax_inclusive: v })} label="Tax inclusive" />
        </View>
        <FieldRow label="Sale start" displayValue={p.pricing_meta?.sale_start?.slice(0, 10) ?? '—'}>
          <DateField value={p.pricing_meta?.sale_start?.slice(0, 10) ?? ''} onChange={v => setPriceMeta({ sale_start: v ? `${v}T00:00:00Z` : null })} />
        </FieldRow>
        <FieldRow label="Sale end" displayValue={p.pricing_meta?.sale_end?.slice(0, 10) ?? '—'}>
          <DateField value={p.pricing_meta?.sale_end?.slice(0, 10) ?? ''} onChange={v => setPriceMeta({ sale_end: v ? `${v}T23:59:59Z` : null })} />
        </FieldRow>
        <FieldRow label="Min quantity" displayValue={p.pricing_meta?.min_quantity != null ? String(p.pricing_meta.min_quantity) : '—'}>
          <TextField value={String(p.pricing_meta?.min_quantity ?? '')} onChangeText={v => setPriceMeta({ min_quantity: toNum(v) })} keyboardType="number-pad" />
        </FieldRow>
        <FieldRow label="Max quantity" displayValue={p.pricing_meta?.max_quantity != null ? String(p.pricing_meta.max_quantity) : '—'} last>
          <TextField value={String(p.pricing_meta?.max_quantity ?? '')} onChangeText={v => setPriceMeta({ max_quantity: toNum(v) })} keyboardType="number-pad" />
        </FieldRow>
      </GroupedCard>

      {/* ── Inventory ── */}
      <SectionLabel>Inventory</SectionLabel>
      <GroupedCard>
        <FieldRow label="Stock quantity" displayValue={String(p.stock_quantity)}>
          <TextField value={String(p.stock_quantity)} onChangeText={v => set({ stock_quantity: toNum(v) ?? 0 })} keyboardType="number-pad" />
        </FieldRow>
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 56, paddingHorizontal: t.space.lg, gap: t.space.md }}>
          <Text variant="label" style={{ flex: 1 }}>Stock status</Text>
          <Badge label={p.stock_status} tone={stockBadge(p.stock_status)} />
        </View>
        <FieldRow label="Low stock threshold" displayValue={p.low_stock_threshold != null ? String(p.low_stock_threshold) : '—'}>
          <TextField value={String(p.low_stock_threshold ?? '')} onChangeText={v => set({ low_stock_threshold: toNum(v) })} keyboardType="number-pad" />
        </FieldRow>
        <FieldRow label="Warehouse location" displayValue={p.warehouse_location || '—'}>
          <TextField value={p.warehouse_location ?? ''} onChangeText={v => set({ warehouse_location: v || null })} />
        </FieldRow>
        <FieldRow label="Lead time (days)" displayValue={p.lead_time_days != null ? String(p.lead_time_days) : '—'}>
          <TextField value={String(p.lead_time_days ?? '')} onChangeText={v => set({ lead_time_days: toNum(v) })} keyboardType="number-pad" />
        </FieldRow>
        <FieldRow label="Restock date" displayValue={p.restock_date ?? '—'} last>
          <DateField value={p.restock_date ?? ''} onChange={v => set({ restock_date: v || null })} />
        </FieldRow>
        <View style={{ paddingHorizontal: t.space.lg }}>
          <Toggle value={p.track_inventory} onChange={v => set({ track_inventory: v })} label="Track inventory" />
          <Toggle value={p.allow_backorder} onChange={v => set({ allow_backorder: v })} label="Allow backorder" />
        </View>
      </GroupedCard>

      {/* ── Identity ── */}
      <SectionLabel>Identity</SectionLabel>
      <GroupedCard>
        <FieldRow label="SKU" displayValue={p.sku || '—'}>
          <TextField value={p.sku ?? ''} onChangeText={v => set({ sku: v || null })} autoCapitalize="none" />
        </FieldRow>
        <FieldRow label="Slug" displayValue={p.slug || '—'}>
          <TextField value={p.slug ?? ''} onChangeText={v => set({ slug: v || null })} autoCapitalize="none" />
        </FieldRow>
        <FieldRow label="Handle" displayValue={p.handle || '—'}>
          <TextField value={p.handle ?? ''} onChangeText={v => set({ handle: v || null })} autoCapitalize="none" />
        </FieldRow>
        <FieldRow label="GTIN" displayValue={p.gtin || '—'}>
          <TextField value={p.gtin ?? ''} onChangeText={v => set({ gtin: v || null })} autoCapitalize="none" />
        </FieldRow>
        <FieldRow label="MPN" displayValue={p.mpn || '—'} last>
          <TextField value={p.mpn ?? ''} onChangeText={v => set({ mpn: v || null })} autoCapitalize="none" />
        </FieldRow>
      </GroupedCard>

      {/* ── Specifications ── */}
      <SectionLabel>Specifications</SectionLabel>
      <GroupedCard>
        <FieldRow label="Brand" displayValue={p.specifications?.brand || '—'}>
          <TextField value={p.specifications?.brand ?? ''} onChangeText={v => setSpecs({ brand: v || null })} />
        </FieldRow>
        <FieldRow label="Manufacturer" displayValue={p.specifications?.manufacturer || '—'}>
          <TextField value={p.specifications?.manufacturer ?? ''} onChangeText={v => setSpecs({ manufacturer: v || null })} />
        </FieldRow>
        <FieldRow label="Model" displayValue={p.specifications?.model || '—'}>
          <TextField value={p.specifications?.model ?? ''} onChangeText={v => setSpecs({ model: v || null })} />
        </FieldRow>
        <FieldRow label="Material" displayValue={p.specifications?.material || '—'}>
          <TextField value={p.specifications?.material ?? ''} onChangeText={v => setSpecs({ material: v || null })} />
        </FieldRow>
        <FieldRow label="Colour" displayValue={p.specifications?.colour || '—'}>
          <TextField value={p.specifications?.colour ?? ''} onChangeText={v => setSpecs({ colour: v || null })} />
        </FieldRow>
        <FieldRow label="Weight (grams)" displayValue={p.specifications?.weight_grams != null ? String(p.specifications.weight_grams) : '—'}>
          <TextField value={String(p.specifications?.weight_grams ?? '')} onChangeText={v => setSpecs({ weight_grams: toNum(v) })} keyboardType="number-pad" />
        </FieldRow>
        <FieldRow label="Country of origin" displayValue={p.specifications?.country_of_origin || '—'} last>
          <TextField value={p.specifications?.country_of_origin ?? ''} onChangeText={v => setSpecs({ country_of_origin: v || null })} />
        </FieldRow>
      </GroupedCard>

      {/* ── Shipping ── */}
      <SectionLabel>Shipping</SectionLabel>
      <GroupedCard>
        <View style={{ paddingHorizontal: t.space.lg }}>
          <Toggle value={p.shipping_info?.requires_shipping ?? true} onChange={v => setShipping({ requires_shipping: v })} label="Can be delivered" />
          <Toggle value={p.shipping_info?.free_shipping ?? false} onChange={v => setShipping({ free_shipping: v })} label="Free shipping" />
          <Toggle value={p.shipping_info?.hazardous ?? false} onChange={v => setShipping({ hazardous: v })} label="Hazardous material" />
        </View>
        <FieldRow label="Shipping weight (g)" displayValue={p.shipping_info?.shipping_weight_grams != null ? String(p.shipping_info.shipping_weight_grams) : '—'}>
          <TextField value={String(p.shipping_info?.shipping_weight_grams ?? '')} onChangeText={v => setShipping({ shipping_weight_grams: toNum(v) })} keyboardType="number-pad" />
        </FieldRow>
        <FieldRow label="Shipping class" displayValue={p.shipping_info?.shipping_class || '—'}>
          <TextField value={p.shipping_info?.shipping_class ?? ''} onChangeText={v => setShipping({ shipping_class: v || null })} />
        </FieldRow>
        <FieldRow label="HS tariff code" displayValue={p.shipping_info?.hs_tariff_code || '—'}>
          <TextField value={p.shipping_info?.hs_tariff_code ?? ''} onChangeText={v => setShipping({ hs_tariff_code: v || null })} autoCapitalize="none" />
        </FieldRow>
        <FieldRow label="Ships from" displayValue={p.shipping_info?.ships_from || '—'}>
          <TextField value={p.shipping_info?.ships_from ?? ''} onChangeText={v => setShipping({ ships_from: v || null })} />
        </FieldRow>
        <FieldRow label="Delivery estimate" displayValue={p.shipping_info?.delivery_estimate || '—'} last>
          <TextField value={p.shipping_info?.delivery_estimate ?? ''} onChangeText={v => setShipping({ delivery_estimate: v || null })} />
        </FieldRow>
      </GroupedCard>

      {/* ── Organisation ── */}
      <SectionLabel>Organisation</SectionLabel>
      <GroupedCard>
        <FieldRow label="Category" displayValue={p.organisation?.category || '—'}>
          <TextField value={p.organisation?.category ?? ''} onChangeText={v => setOrg({ category: v || null })} />
        </FieldRow>
        <FieldRow label="Vendor" displayValue={p.specifications?.brand || '—'}>
          <TextField value={p.specifications?.brand ?? ''} onChangeText={v => setSpecs({ brand: v || null })} />
        </FieldRow>
        <FieldRow label="Collections" displayValue={fromArr(p.organisation?.collections)}>
          <TextField value={fromArr(p.organisation?.collections)} onChangeText={v => setOrg({ collections: toArr(v) })} placeholder="Comma-separated" />
        </FieldRow>
        <FieldRow label="Tags" displayValue={fromArr(p.organisation?.tags)}>
          <TextField value={fromArr(p.organisation?.tags)} onChangeText={v => setOrg({ tags: toArr(v) })} placeholder="Comma-separated" />
        </FieldRow>
        <FieldRow label="Related product IDs" displayValue={fromArr(p.organisation?.related_product_ids)} last>
          <TextField value={fromArr(p.organisation?.related_product_ids)} onChangeText={v => setOrg({ related_product_ids: toArr(v) })} placeholder="Comma-separated" autoCapitalize="none" />
        </FieldRow>
      </GroupedCard>

      {/* ── SEO ── */}
      <SectionLabel>SEO</SectionLabel>
      <GroupedCard>
        <FieldRow label="Meta title" displayValue={p.seo?.meta_title || '—'}>
          <TextField value={p.seo?.meta_title ?? ''} onChangeText={v => setSeo({ meta_title: v || null })} />
        </FieldRow>
        <FieldRow label="Meta description" displayValue={p.seo?.meta_description || '—'}>
          <TextField value={p.seo?.meta_description ?? ''} onChangeText={v => setSeo({ meta_description: v || null })} multiline />
        </FieldRow>
        <FieldRow label="Canonical URL" displayValue={p.seo?.canonical_url || '—'}>
          <TextField value={p.seo?.canonical_url ?? ''} onChangeText={v => setSeo({ canonical_url: v || null })} autoCapitalize="none" />
        </FieldRow>
        <FieldRow label="OG image URL" displayValue={p.seo?.og_image || '—'}>
          <TextField value={p.seo?.og_image ?? ''} onChangeText={v => setSeo({ og_image: v || null })} autoCapitalize="none" />
        </FieldRow>
        <FieldRow label="Keywords" displayValue={fromArr(p.seo?.keywords)} last>
          <TextField value={fromArr(p.seo?.keywords)} onChangeText={v => setSeo({ keywords: toArr(v) })} placeholder="Comma-separated" />
        </FieldRow>
      </GroupedCard>

      {/* ── Channels ── */}
      <SectionLabel>Channels</SectionLabel>
      <GroupedCard>
        <FieldRow label="Sales channels" displayValue={fromArr(p.sales_channels)}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
            {['web', 'pos', 'instagram', 'facebook'].map(ch => (
              <Pill key={ch} label={ch}
                active={p.sales_channels?.includes(ch) ?? false}
                onPress={() => {
                  const current = p.sales_channels ?? [];
                  set({ sales_channels: current.includes(ch) ? current.filter(x => x !== ch) : [...current, ch] });
                }}
              />
            ))}
          </View>
        </FieldRow>
        <FieldRow label="Available regions" displayValue={fromArr(p.available_regions)} last>
          <TextField value={fromArr(p.available_regions)} onChangeText={v => set({ available_regions: toArr(v) })} placeholder="NZ, AU…" autoCapitalize="none" />
        </FieldRow>
      </GroupedCard>

      {/* ── Social proof ── */}
      <SectionLabel>Social proof</SectionLabel>
      <GroupedCard>
        <FieldRow label="Rating average" displayValue={p.rating_average != null ? String(p.rating_average) : '—'}>
          <TextField value={String(p.rating_average ?? '')} onChangeText={v => set({ rating_average: toFloat(v) })} keyboardType="default" />
        </FieldRow>
        <FieldRow label="Rating count" displayValue={String(p.rating_count)}>
          <TextField value={String(p.rating_count)} onChangeText={v => set({ rating_count: toNum(v) ?? 0 })} keyboardType="number-pad" />
        </FieldRow>
        <FieldRow label="Badges" displayValue={fromArr(p.social_proof?.badges)} last>
          <TextField value={fromArr(p.social_proof?.badges)} onChangeText={v => setProof({ badges: toArr(v) })} placeholder="Best Seller, New…" />
        </FieldRow>
      </GroupedCard>

      {/* ── Compliance ── */}
      <SectionLabel>Compliance</SectionLabel>
      <GroupedCard>
        <View style={{ paddingHorizontal: t.space.lg }}>
          <Toggle value={p.compliance?.age_restricted ?? false} onChange={v => setCompliance({ age_restricted: v })} label="Age restricted" />
          <Toggle value={p.compliance?.returnable ?? true} onChange={v => setCompliance({ returnable: v })} label="Returnable" />
        </View>
        {p.compliance?.age_restricted && (
          <FieldRow label="Minimum age" displayValue={p.compliance?.min_age != null ? String(p.compliance.min_age) : '—'}>
            <TextField value={String(p.compliance?.min_age ?? '')} onChangeText={v => setCompliance({ min_age: toNum(v) })} keyboardType="number-pad" />
          </FieldRow>
        )}
        <FieldRow label="Return window (days)" displayValue={p.compliance?.return_window_days != null ? String(p.compliance.return_window_days) : '—'}>
          <TextField value={String(p.compliance?.return_window_days ?? '')} onChangeText={v => setCompliance({ return_window_days: toNum(v) })} keyboardType="number-pad" />
        </FieldRow>
        <FieldRow label="Certifications" displayValue={fromArr(p.compliance?.certifications)} last>
          <TextField value={fromArr(p.compliance?.certifications)} onChangeText={v => setCompliance({ certifications: toArr(v) })} placeholder="Comma-separated" />
        </FieldRow>
      </GroupedCard>

      {/* ── Variants ── */}
      <SectionLabel right={
        <Pressable onPress={() => setAddingVariant(v => !v)} accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name={addingVariant ? 'close' : 'add'} size={16} color={t.color.primary} />
          <Text variant="small" color={t.color.primary}>{addingVariant ? 'Cancel' : 'Add variant'}</Text>
        </Pressable>
      }>Variants</SectionLabel>

      {/* Variant option names — editable if no variants yet */}
      {variants.length === 0 && (
        <GroupedCard>
          <FieldRow label="Option names" displayValue={fromArr(p.variant_options?.option_names)} last>
            <TextField
              value={fromArr(p.variant_options?.option_names)}
              onChangeText={v => setVariantOpts({ option_names: toArr(v) })}
              placeholder="Size, Colour…"
            />
          </FieldRow>
          {(p.variant_options?.option_names ?? []).map(dim => (
            <FieldRow key={dim} label={dim} displayValue={fromArr((p.variant_options?.options ?? {})[dim])} last>
              <TextField
                value={fromArr((p.variant_options?.options ?? {})[dim])}
                onChangeText={v => setVariantOpts({ options: { ...(p.variant_options?.options ?? {}), [dim]: toArr(v) } })}
                placeholder="Comma-separated values"
              />
            </FieldRow>
          ))}
        </GroupedCard>
      )}

      <GroupedCard>
        {variants.length === 0 && !addingVariant && (
          <View style={{ paddingHorizontal: t.space.lg, paddingVertical: t.space.md }}>
            <Text variant="small" muted>No variants yet.</Text>
          </View>
        )}
        {variants.map((v, i) => (
          <VariantRow
            key={v.id}
            variant={v}
            productId={productId}
            onUpdated={updated => setVariants(vs => vs.map(x => x.id === updated.id ? updated : x))}
            onDeleted={id => setVariants(vs => vs.filter(x => x.id !== id))}
          />
        ))}
        {addingVariant && (
          <AddVariantForm
            productId={productId}
            options={variantOptionEntries.length ? Object.fromEntries(variantOptionEntries) : { Size: [] }}
            onAdded={v => { setVariants(vs => [...vs, v]); setAddingVariant(false); }}
            onCancel={() => setAddingVariant(false)}
          />
        )}
      </GroupedCard>

      {/* Floating save bar when dirty */}
      {(dirty || isUploading) && (
        <View style={{ flexDirection: 'row', gap: t.space.md }}>
          <Button label={isUploading ? 'Waiting for uploads…' : saving ? 'Saving…' : 'Save changes'} onPress={save} loading={saving} disabled={isUploading} style={{ flex: 1 }} />
          <Button label="Discard" variant="ghost" onPress={() => { setDraft({}); setDirty(false); }} disabled={saving} />
        </View>
      )}

    </Screen>
  );
}
