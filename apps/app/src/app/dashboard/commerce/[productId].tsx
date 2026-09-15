import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { View, Pressable, Image, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
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
import { readThrough } from '@/lib/mirror';
import { Screen, Text, Button, Toggle, Pill, GroupedCard, FieldRow, Badge, TextField } from '@/ui/components';
import { OfflineBanner } from '@/ui/status';
import { DateField } from '@/ui/date-field';
import { useTheme } from '@/theme';
import { useProfile } from '@/lib/profile-context';

// ── Groups definition ─────────────────────────────────────────────────────────
const GROUPS = [
  { id: 'basics',     icon: 'cube-outline',            label: 'The basics' },
  { id: 'price',      icon: 'pricetag-outline',         label: 'Price' },
  { id: 'stock',      icon: 'layers-outline',           label: 'Stock' },
  { id: 'variants',   icon: 'options-outline',          label: 'Sizes & options' },
  { id: 'delivery',   icon: 'car-outline',              label: 'Delivery' },
  { id: 'details',    icon: 'list-outline',             label: 'Product details' },
  { id: 'listing',    icon: 'storefront-outline',       label: 'Store listing' },
  { id: 'compliance', icon: 'shield-checkmark-outline', label: 'Codes & compliance' },
] as const;
type GroupId = typeof GROUPS[number]['id'];

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
function PillSelect<T extends string>({ options, value, onChange, size }: {
  options: T[]; value: T; onChange: (v: T) => void; size?: 'sm';
}) {
  const t = useTheme();
  const s = makeStyles(t);
  return (
    <View style={s.pillRow}>
      {options.map(o => <Pill key={o} label={o} active={value === o} onPress={() => onChange(o)} size={size} />)}
    </View>
  );
}

// ── ImageRow ──────────────────────────────────────────────────────────────────
function ImageRow({ slots, onAdd, onRetry, coverIndex, onSetCover }: {
  slots: ImageSlot[]; onAdd: () => void; onRetry: (id: string) => void;
  coverIndex: number; onSetCover: (index: number) => void;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.imageScroll}>
      <View style={s.imageSlotRow}>
        {slots.map((slot, i) => (
          <Pressable key={slot.id}
            onPress={slot.status === 'error' ? () => onRetry(slot.id) : () => onSetCover(i)}
            style={s.imageSlot}>
            <Image source={{ uri: slot.localUri }} style={s.imageThumb} resizeMode="cover" />
            {slot.status === 'uploading' && (
              <View style={s.imageOverlay}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            )}
            {slot.status === 'error' && (
              <View style={[s.imageOverlay, s.imageOverlayError]}>
                <Ionicons name="refresh" size={20} color="#fff" />
              </View>
            )}
            {slot.status !== 'error' && slot.status !== 'uploading' && i === coverIndex && (
              <View style={s.coverBadge}>
                <Ionicons name="star" size={11} color="#fff" />
              </View>
            )}
          </Pressable>
        ))}
        <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel="Add image" style={s.imageAdd}>
          <Ionicons name="add" size={28} color={t.color.textMuted} />
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ── ImagePicker ───────────────────────────────────────────────────────────────
// Mounted only after product loads (key={product.id}) so useImageSlots gets real initialUrls
function ImagePicker({ initialUrls, onError, onResult, coverIndex, onSetCover }: {
  initialUrls: string[];
  onError: (msg: string) => void;
  onResult: (doneUrls: string[], isUploading: boolean) => void;
  coverIndex: number;
  onSetCover: (index: number) => void;
}) {
  const { slots, pick, retrySlot, doneUrls, isUploading } = useImageSlots(initialUrls, onError);
  const uploadFn: UploadFn = (f) => uploadProductImage(tok(), f);
  useEffect(() => { onResult(doneUrls, isUploading); }, [doneUrls, isUploading, onResult]);
  return (
    <ImageRow
      slots={slots}
      onAdd={() => void pick(uploadFn, onError)}
      onRetry={(id) => retrySlot(id, uploadFn)}
      coverIndex={coverIndex}
      onSetCover={onSetCover}
    />
  );
}

// ── Group (accordion) ─────────────────────────────────────────────────────────
function Group({ icon, label, summary, children, defaultOpen = false }: {
  icon: string; label: string; summary: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={s.group}>
      <Pressable onPress={() => setOpen(o => !o)} style={s.groupHeader} accessibilityRole="button">
        <Ionicons name={icon as never} size={20} color={t.color.textMuted} />
        <View style={s.groupHeaderText}>
          <Text variant="label">{label}</Text>
          <Text variant="small" muted numberOfLines={1}>{summary}</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t.color.textMuted} />
      </Pressable>
      {open && <View style={s.groupBody}>{children}</View>}
    </View>
  );
}

// ── VariantRow ────────────────────────────────────────────────────────────────
function VariantRow({ variant, productId, onUpdated, onDeleted }: {
  variant: ProductVariant; productId: string; onUpdated: (v: ProductVariant) => void; onDeleted: (id: string) => void;
}) {
  const t = useTheme();
  const s = makeStyles(t);
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
    <View style={s.variantRow}>
      <Pressable onPress={() => setOpen(o => !o)} style={s.variantHeader}>
        <View style={s.variantTitle}>
          <Text variant="label">{optionLabel}</Text>
          {variant.sku && <Text variant="small" muted>{variant.sku}</Text>}
        </View>
        <Text variant="small" muted>{variant.stock_quantity} stock</Text>
        {variant.price_cents != null && <Text variant="small" muted>${fmt(variant.price_cents)}</Text>}
        <Ionicons name={open ? 'chevron-up' : 'chevron-forward'} size={14} color={t.color.textMuted} />
      </Pressable>
      {open && (
        <View style={s.variantBody}>
          <TextField label="SKU" value={draft.sku ?? ''} onChangeText={v => set({ sku: v || null })} />
          <TextField label="Title" value={draft.title ?? ''} onChangeText={v => set({ title: v || null })} />
          <TextField label="Price override" value={fmt(draft.price_cents)} onChangeText={v => set({ price_cents: toCents(v) })} keyboardType="default" />
          <TextField label="Compare-at price" value={fmt(draft.compare_at_price_cents)} onChangeText={v => set({ compare_at_price_cents: toCents(v) })} keyboardType="default" />
          <TextField label="Stock quantity" value={String(draft.stock_quantity)} onChangeText={v => set({ stock_quantity: toNum(v) ?? 0 })} keyboardType="number-pad" />
          <TextField label="Warehouse location" value={draft.warehouse_location ?? ''} onChangeText={v => set({ warehouse_location: v || null })} />
          <Toggle value={draft.track_inventory} onChange={v => set({ track_inventory: v })} label="Track inventory" />
          <Toggle value={draft.allow_backorder} onChange={v => set({ allow_backorder: v })} label="Allow backorder" />
          <Toggle value={draft.is_default} onChange={v => set({ is_default: v })} label="Default variant" />
          <Toggle value={draft.active} onChange={v => set({ active: v })} label="Active" />
          <View style={s.variantActions}>
            <Button label="Save" onPress={save} loading={saving} disabled={!dirty} style={s.flex1} size="sm" />
            <Button label="Delete" variant="danger" onPress={remove} size="sm" />
          </View>
        </View>
      )}
    </View>
  );
}

// ── AddVariantForm ────────────────────────────────────────────────────────────
function AddVariantForm({ productId, options, onAdded, onCancel }: {
  productId: string; options: Record<string, string[]>; onAdded: (v: ProductVariant) => void; onCancel: () => void;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [sku, setSku]           = useState('');
  const [price, setPrice]       = useState('');
  const [stock, setStock]       = useState('0');
  const [saving, setSaving]     = useState(false);

  const toggle = (dim: string, val: string) =>
    setSelected(prev => ({ ...prev, [dim]: prev[dim] === val ? '' : val }));

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
    <View style={s.addVariantForm}>
      {Object.entries(options).map(([dim, vals]) => (
        <View key={dim} style={s.addVariantDim}>
          <Text variant="label" muted>{dim}</Text>
          <View style={s.pillRow}>
            {vals.map(v => <Pill key={v} label={v} active={selected[dim] === v} onPress={() => toggle(dim, v)} size="sm" />)}
          </View>
        </View>
      ))}
      <TextField label="SKU (optional)" value={sku} onChangeText={setSku} />
      <TextField label="Price override" value={price} onChangeText={setPrice} keyboardType="default" />
      <TextField label="Stock quantity" value={stock} onChangeText={setStock} keyboardType="number-pad" />
      <View style={s.variantActions}>
        <Button label="Add variant" onPress={submit} loading={saving} style={s.flex1} size="sm" />
        <Button label="Cancel" variant="ghost" onPress={onCancel} size="sm" />
      </View>
    </View>
  );
}

// ── Product detail screen ─────────────────────────────────────────────────────
export default function ProductDetail() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const { data: profile } = useProfile();
  const currency = profile?.org?.currency ?? process.env.EXPO_PUBLIC_CURRENCY ?? 'NZD';
  const isDesktop = width >= 900;

  const [product, setProduct]   = useState<Product | null>(null);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [loading, setLoading]   = useState(true);
  const [offline, setOffline]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [draft, setDraft]       = useState<Partial<Product>>({});
  const [dirty, setDirty]       = useState(false);
  const [addingVariant, setAddingVariant] = useState(false);
  const [toast, setToast]       = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [activeGroup, setActiveGroup] = useState<GroupId>('basics');
  const [imgState, setImgState] = useState<{ doneUrls: string[]; isUploading: boolean }>({ doneUrls: [], isUploading: false });
  const [coverIndex, setCoverIndex] = useState(0);
  const imgMounted = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, vRes] = await Promise.all([
        readThrough(`commerce:product:${productId}`, () => getAdminProduct(tok(), productId)),
        readThrough(`commerce:variants:${productId}`, () => listProductVariants(tok(), productId)),
      ]);
      const { product: p } = pRes.value;
      const { variants: vs } = vRes.value;
      setProduct(p); setVariants(vs); setDraft({});
      setOffline(pRes.stale || vRes.stale);
    } catch (e) { setToast({ text: e instanceof Error ? e.message : 'Failed to load', tone: 'error' }); }
    finally { setLoading(false); }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!product) return;
    imgMounted.current = false;
    const g = product.media?.gallery ?? [];
    const idx = g.indexOf(product.media?.primary_image ?? '');
    setCoverIndex(idx >= 0 ? idx : 0);
  }, [product?.id]);

  const p = useMemo(() => ({ ...product, ...draft }) as Product, [product, draft]);

  const set = useCallback((patch: Partial<Product>) => { setDraft(d => ({ ...d, ...patch })); setDirty(true); }, []);
  const setContent    = useCallback((c: Partial<ProductContent>)        => set({ content:        { ...product?.content,        ...draft.content,        ...c } }), [product, draft, set]);
  const setMedia      = useCallback((m: Partial<ProductMedia>)           => set({ media:          { ...product?.media,          ...draft.media,          ...m } }), [product, draft, set]);
  const setSpecs      = useCallback((sp: Partial<ProductSpecifications>) => set({ specifications: { ...product?.specifications, ...draft.specifications, ...sp } }), [product, draft, set]);
  const setShipping   = useCallback((sh: Partial<ProductShippingInfo>)   => set({ shipping_info:  { ...product?.shipping_info,  ...draft.shipping_info,  ...sh } }), [product, draft, set]);
  const setOrg        = useCallback((o: Partial<ProductOrganisation>)    => set({ organisation:   { ...product?.organisation,   ...draft.organisation,   ...o } }), [product, draft, set]);
  const setSeo        = useCallback((se: Partial<ProductSeo>)            => set({ seo:            { ...product?.seo,            ...draft.seo,            ...se } }), [product, draft, set]);
  const setProof      = useCallback((pr: Partial<ProductSocialProof>)    => set({ social_proof:   { ...product?.social_proof,   ...draft.social_proof,   ...pr } }), [product, draft, set]);
  const setPriceMeta  = useCallback((m: Partial<ProductPricingMeta>)     => set({ pricing_meta:   { ...product?.pricing_meta,   ...draft.pricing_meta,   ...m } }), [product, draft, set]);
  const setCompliance = useCallback((c: Partial<ProductCompliance>)      => set({ compliance:     { ...product?.compliance,     ...draft.compliance,     ...c } }), [product, draft, set]);
  const setVariantOpts = useCallback((v: Partial<ProductVariantOptions>) => set({ variant_options: { ...product?.variant_options, ...draft.variant_options, ...v } }), [product, draft, set]);

  const handleImgResult = useCallback((doneUrls: string[], isUploading: boolean) => {
    setImgState({ doneUrls, isUploading });
    if (!imgMounted.current) { imgMounted.current = true; return; }
    setDirty(true);
  }, []);

  const initialImages = useMemo(() => {
    const g = product?.media?.gallery ?? [];
    return g.length ? g : product?.media?.primary_image ? [product.media.primary_image] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  const save = async () => {
    setSaving(true);
    try {
      const safeIdx = Math.min(coverIndex, imgState.doneUrls.length - 1);
      const mediaUpdate = { ...p.media, primary_image: safeIdx >= 0 ? imgState.doneUrls[safeIdx] : null, gallery: imgState.doneUrls };
      const { product: updated } = await updateProduct(tok(), productId, { ...draft, media: mediaUpdate });
      setProduct(updated); setDraft({}); setDirty(false); imgMounted.current = false;
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
  const coverUri = imgState.doneUrls[coverIndex] ?? imgState.doneUrls[0] ?? product.media?.primary_image ?? null;
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/dashboard/commerce' as never);

  function groupSummary(id: GroupId): string {
    switch (id) {
      case 'basics':     return `${p.title}${imgState.doneUrls.length ? ` · ${imgState.doneUrls.length} photo${imgState.doneUrls.length !== 1 ? 's' : ''}` : ''}`;
      case 'price':      return `${currency} ${fmt(p.price_cents)}${p.compare_at_price_cents ? ` · was ${currency} ${fmt(p.compare_at_price_cents)}` : ''}`;
      case 'stock':      return `${p.stock_quantity} in stock · ${p.track_inventory ? 'tracked' : 'not tracked'}`;
      case 'variants':   return variants.length > 0 ? `${variants.length} variant${variants.length !== 1 ? 's' : ''} · ${fromArr(p.variant_options?.option_names)}` : fromArr(p.variant_options?.option_names) || 'No variants';
      case 'delivery':   return `${p.shipping_info?.requires_shipping ? 'Delivers' : 'Not delivered'} · ${p.shipping_info?.shipping_weight_grams ?? '—'} g`;
      case 'details':    return [p.specifications?.brand, p.specifications?.material, p.specifications?.colour].filter(Boolean).join(' · ') || '—';
      case 'listing':    return `${p.visibility} · ${fromArr(p.sales_channels)} · ${p.organisation?.category || '—'}`;
      case 'compliance': return `${p.sku || '—'} · returns ${p.compliance?.return_window_days ?? '—'} days`;
    }
  }

  function renderGroupContent(id: GroupId): React.ReactNode {
    switch (id) {

      case 'basics': return <>
        <View style={s.imageSection}>
          <Text variant="label" muted>Images</Text>
          <ImagePicker
            key={product!.id}
            initialUrls={initialImages}
            onError={(msg) => setToast({ text: msg, tone: 'error' })}
            onResult={handleImgResult}
            coverIndex={coverIndex}
            onSetCover={setCoverIndex}
          />
        </View>
        <GroupedCard>
          <FieldRow label="Title" displayValue={p.title}>
            <TextField value={p.title} onChangeText={v => set({ title: v })} />
          </FieldRow>
          <FieldRow label="Subtitle" displayValue={p.content?.subtitle || '—'}>
            <TextField value={p.content?.subtitle ?? ''} onChangeText={v => setContent({ subtitle: v || null })} />
          </FieldRow>
          <FieldRow label="Short description" displayValue={p.content?.short_description || '—'}>
            <TextField value={p.content?.short_description ?? ''} onChangeText={v => setContent({ short_description: v || null })} multiline />
          </FieldRow>
          <FieldRow label="Description" displayValue={p.description || '—'}>
            <TextField value={p.description ?? ''} onChangeText={v => set({ description: v })} multiline />
          </FieldRow>
          <FieldRow label="Full description (HTML)" displayValue={p.content?.description_html ? '(set)' : '—'}>
            <TextField value={p.content?.description_html ?? ''} onChangeText={v => setContent({ description_html: v || null })} multiline />
          </FieldRow>
          <FieldRow label="Features" displayValue={fromArr(p.content?.features)}>
            <TextField value={fromArr(p.content?.features)} onChangeText={v => setContent({ features: toArr(v) })} placeholder="Comma-separated" />
          </FieldRow>
          <FieldRow label="Alt text" displayValue={p.media?.alt_text || '—'}>
            <TextField value={p.media?.alt_text ?? ''} onChangeText={v => setMedia({ alt_text: v || null })} />
          </FieldRow>
          <FieldRow label="Video URL" displayValue={p.media?.video_url || '—'}>
            <TextField value={p.media?.video_url ?? ''} onChangeText={v => setMedia({ video_url: v || null })} autoCapitalize="none" />
          </FieldRow>
          <FieldRow label="Size chart URL" displayValue={p.media?.size_chart_url || '—'} last>
            <TextField value={p.media?.size_chart_url ?? ''} onChangeText={v => setMedia({ size_chart_url: v || null })} autoCapitalize="none" />
          </FieldRow>
        </GroupedCard>
      </>;

      case 'price': return (
        <GroupedCard>
          <FieldRow label="Price" displayValue={`${currency} ${fmt(p.price_cents)}`}>
            <TextField value={fmt(p.price_cents)} onChangeText={v => set({ price_cents: toCents(v) ?? 0 })} keyboardType="default" />
          </FieldRow>
          <FieldRow label="Compare-at price" displayValue={p.compare_at_price_cents ? `${currency} ${fmt(p.compare_at_price_cents)}` : '—'}>
            <TextField value={fmt(p.compare_at_price_cents)} onChangeText={v => set({ compare_at_price_cents: toCents(v) })} keyboardType="default" />
          </FieldRow>
          <FieldRow label="Cost price" displayValue={p.cost_price_cents ? `${currency} ${fmt(p.cost_price_cents)}` : '—'}>
            <TextField value={fmt(p.cost_price_cents)} onChangeText={v => set({ cost_price_cents: toCents(v) })} keyboardType="default" />
          </FieldRow>
          <FieldRow label="Currency" displayValue={p.currency}>
            <TextField value={p.currency} onChangeText={v => set({ currency: v.toUpperCase() })} autoCapitalize="none" />
          </FieldRow>
          <FieldRow label="Tax class" displayValue={p.tax_class || '—'}>
            <TextField value={p.tax_class ?? ''} onChangeText={v => set({ tax_class: v || null })} />
          </FieldRow>
          <View style={s.toggleContainer}>
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
      );

      case 'stock': return (
        <GroupedCard>
          <FieldRow label="Stock quantity" displayValue={String(p.stock_quantity)}>
            <TextField value={String(p.stock_quantity)} onChangeText={v => set({ stock_quantity: toNum(v) ?? 0 })} keyboardType="number-pad" />
          </FieldRow>
          <View style={s.stockStatusRow}>
            <Text variant="label" style={s.flex1}>Stock status</Text>
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
          <View style={s.toggleContainer}>
            <Toggle value={p.track_inventory} onChange={v => set({ track_inventory: v })} label="Track inventory" />
            <Toggle value={p.allow_backorder} onChange={v => set({ allow_backorder: v })} label="Allow backorder" />
          </View>
        </GroupedCard>
      );

      case 'variants': return <>
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
            <View style={s.noVariants}>
              <Text variant="small" muted>No variants yet.</Text>
            </View>
          )}
          {variants.map((v) => (
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
        <Pressable onPress={() => setAddingVariant(v => !v)} style={s.addVariantToggle} accessibilityRole="button">
          <Ionicons name={addingVariant ? 'close' : 'add'} size={16} color={t.color.primary} />
          <Text variant="small" color={t.color.primary}>{addingVariant ? 'Cancel' : 'Add variant'}</Text>
        </Pressable>
      </>;

      case 'delivery': return (
        <GroupedCard>
          <View style={s.toggleContainer}>
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
      );

      case 'details': return (
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
          <FieldRow label="Country of origin" displayValue={p.specifications?.country_of_origin || '—'}>
            <TextField value={p.specifications?.country_of_origin ?? ''} onChangeText={v => setSpecs({ country_of_origin: v || null })} />
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
      );

      case 'listing': return (
        <GroupedCard>
          <FieldRow label="Status" displayValue={p.status}>
            <PillSelect<ProductStatus> options={['active', 'draft', 'archived']} value={p.status} onChange={v => set({ status: v })} size="sm" />
          </FieldRow>
          <FieldRow label="Visibility" displayValue={p.visibility}>
            <PillSelect<ProductVisibility> options={['public', 'private', 'password']} value={p.visibility} onChange={v => set({ visibility: v })} size="sm" />
          </FieldRow>
          <FieldRow label="Type" displayValue={p.product_type}>
            <PillSelect<ProductType> options={['physical', 'digital', 'service']} value={p.product_type} onChange={v => set({ product_type: v })} size="sm" />
          </FieldRow>
          <FieldRow label="Sales channels" displayValue={fromArr(p.sales_channels)}>
            <View style={s.pillRow}>
              {['web', 'pos', 'instagram', 'facebook'].map(ch => (
                <Pill key={ch} label={ch} size="sm"
                  active={p.sales_channels?.includes(ch) ?? false}
                  onPress={() => {
                    const current = p.sales_channels ?? [];
                    set({ sales_channels: current.includes(ch) ? current.filter(x => x !== ch) : [...current, ch] });
                  }}
                />
              ))}
            </View>
          </FieldRow>
          <FieldRow label="Category" displayValue={p.organisation?.category || '—'}>
            <TextField value={p.organisation?.category ?? ''} onChangeText={v => setOrg({ category: v || null })} />
          </FieldRow>
          <FieldRow label="Collections" displayValue={fromArr(p.organisation?.collections)}>
            <TextField value={fromArr(p.organisation?.collections)} onChangeText={v => setOrg({ collections: toArr(v) })} placeholder="Comma-separated" />
          </FieldRow>
          <FieldRow label="Tags" displayValue={fromArr(p.organisation?.tags)}>
            <TextField value={fromArr(p.organisation?.tags)} onChangeText={v => setOrg({ tags: toArr(v) })} placeholder="Comma-separated" />
          </FieldRow>
          <FieldRow label="Vendor" displayValue={p.specifications?.brand || '—'}>
            <TextField value={p.specifications?.brand ?? ''} onChangeText={v => setSpecs({ brand: v || null })} />
          </FieldRow>
          <FieldRow label="Related product IDs" displayValue={fromArr(p.organisation?.related_product_ids)}>
            <TextField value={fromArr(p.organisation?.related_product_ids)} onChangeText={v => setOrg({ related_product_ids: toArr(v) })} placeholder="Comma-separated" autoCapitalize="none" />
          </FieldRow>
          <FieldRow label="Available regions" displayValue={fromArr(p.available_regions)}>
            <TextField value={fromArr(p.available_regions)} onChangeText={v => set({ available_regions: toArr(v) })} placeholder="NZ, AU…" autoCapitalize="none" />
          </FieldRow>
          <FieldRow label="Published" displayValue={p.published_at ? p.published_at.slice(0, 10) : '—'}>
            <DateField value={p.published_at?.slice(0, 10) ?? ''} onChange={v => set({ published_at: v ? `${v}T00:00:00Z` : null })} placeholder="Not yet published" />
          </FieldRow>
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
          <FieldRow label="Keywords" displayValue={fromArr(p.seo?.keywords)}>
            <TextField value={fromArr(p.seo?.keywords)} onChangeText={v => setSeo({ keywords: toArr(v) })} placeholder="Comma-separated" />
          </FieldRow>
          <View style={s.toggleContainer}>
            <Toggle value={p.featured} onChange={v => set({ featured: v })} label="Featured" />
            <Toggle value={p.active} onChange={v => set({ active: v })} label="Visible in shop" />
            <Toggle value={p.is_digital} onChange={v => set({ is_digital: v })} label="Digital product" />
          </View>
        </GroupedCard>
      );

      case 'compliance': return (
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
          <FieldRow label="MPN" displayValue={p.mpn || '—'}>
            <TextField value={p.mpn ?? ''} onChangeText={v => set({ mpn: v || null })} autoCapitalize="none" />
          </FieldRow>
          <FieldRow label="Return window (days)" displayValue={p.compliance?.return_window_days != null ? String(p.compliance.return_window_days) : '—'}>
            <TextField value={String(p.compliance?.return_window_days ?? '')} onChangeText={v => setCompliance({ return_window_days: toNum(v) })} keyboardType="number-pad" />
          </FieldRow>
          <FieldRow label="Certifications" displayValue={fromArr(p.compliance?.certifications)}>
            <TextField value={fromArr(p.compliance?.certifications)} onChangeText={v => setCompliance({ certifications: toArr(v) })} placeholder="Comma-separated" />
          </FieldRow>
          <FieldRow label="Rating average" displayValue={p.rating_average != null ? String(p.rating_average) : '—'}>
            <TextField value={String(p.rating_average ?? '')} onChangeText={v => set({ rating_average: toFloat(v) })} keyboardType="default" />
          </FieldRow>
          <FieldRow label="Rating count" displayValue={String(p.rating_count)}>
            <TextField value={String(p.rating_count)} onChangeText={v => set({ rating_count: toNum(v) ?? 0 })} keyboardType="number-pad" />
          </FieldRow>
          <FieldRow label="Badges" displayValue={fromArr(p.social_proof?.badges)}>
            <TextField value={fromArr(p.social_proof?.badges)} onChangeText={v => setProof({ badges: toArr(v) })} placeholder="Best Seller, New…" />
          </FieldRow>
          <View style={s.toggleContainer}>
            <Toggle value={p.compliance?.age_restricted ?? false} onChange={v => setCompliance({ age_restricted: v })} label="Age restricted" />
            <Toggle value={p.compliance?.returnable ?? true} onChange={v => setCompliance({ returnable: v })} label="Returnable" />
          </View>
          {p.compliance?.age_restricted && (
            <FieldRow label="Minimum age" displayValue={p.compliance?.min_age != null ? String(p.compliance.min_age) : '—'} last>
              <TextField value={String(p.compliance?.min_age ?? '')} onChangeText={v => setCompliance({ min_age: toNum(v) })} keyboardType="number-pad" />
            </FieldRow>
          )}
        </GroupedCard>
      );
    }
  }

  // ── Desktop layout ────────────────────────────────────────────────────────
  if (isDesktop) {
    return (
      <Screen toast={toast} onDismissToast={() => setToast(null)} scroll={false} maxWidth={1400}>
        <OfflineBanner offline={offline} />

        <View style={s.header}>
          <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Back" style={s.headerBack}>
            <Ionicons name="chevron-back" size={20} color={t.color.primary} />
            <Text variant="label" color={t.color.primary}>Store</Text>
          </Pressable>
          <View style={s.flex1}>
            <Text variant="heading" numberOfLines={1}>{p.title}</Text>
          </View>
          <Badge label={p.status} tone={p.status === 'active' ? 'success' : 'neutral'} />
          {(dirty || imgState.isUploading) && <>
            <Button label="Discard" variant="ghost" size="sm" onPress={() => { setDraft({}); setDirty(false); }} disabled={saving} />
            <Button label={saving ? 'Saving…' : 'Save'} size="sm" onPress={save} loading={saving} disabled={imgState.isUploading} />
          </>}
          {!dirty && !imgState.isUploading && (
            <Button label={saving ? 'Saving…' : 'Save'} size="sm" onPress={save} loading={saving} disabled />
          )}
        </View>

        <View style={s.desktopBody}>
          {/* Sidebar */}
          <View style={s.desktopSidebar}>
            <View style={s.desktopHero}>
              {coverUri ? (
                <Image source={{ uri: coverUri }} style={s.desktopHeroImage} resizeMode="cover" />
              ) : (
                <View style={s.desktopHeroPlaceholder}>
                  <Ionicons name="image-outline" size={32} color={t.color.textMuted} />
                </View>
              )}
              <View style={s.desktopHeroInfo}>
                <Text variant="label" numberOfLines={2}>{p.title}</Text>
                <Text variant="small" muted>{currency} {fmt(p.price_cents)} · {p.stock_quantity} in stock</Text>
              </View>
            </View>
            {GROUPS.map(g => (
              <Pressable key={g.id} onPress={() => setActiveGroup(g.id)}
                style={({ pressed }) => [s.sidebarItem, (activeGroup === g.id || pressed) && s.sidebarItemActive]}>
                <Ionicons name={g.icon as never} size={15} color={activeGroup === g.id ? t.color.primary : t.color.textMuted} />
                <Text variant="small" color={activeGroup === g.id ? t.color.primary : t.color.text}>{g.label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Content area — all groups rendered, non-active hidden to preserve state */}
          <ScrollView style={s.desktopContent} contentContainerStyle={s.desktopContentInner}>
            {GROUPS.map(g => (
              <View key={g.id} style={activeGroup !== g.id ? s.hidden : s.groupContentWrap}>
                {renderGroupContent(g.id)}
              </View>
            ))}
          </ScrollView>
        </View>
      </Screen>
    );
  }

  // ── Mobile layout ─────────────────────────────────────────────────────────
  return (
    <Screen toast={toast} onDismissToast={() => setToast(null)}>
      <OfflineBanner offline={offline} />

      <View style={s.header}>
        <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Back" style={s.headerBack}>
          <Ionicons name="chevron-back" size={20} color={t.color.primary} />
          <Text variant="label" color={t.color.primary}>Store</Text>
        </Pressable>
        <View style={s.flex1}>
          <Text variant="heading" numberOfLines={1}>{p.title}</Text>
        </View>
        <Badge label={p.status} tone={p.status === 'active' ? 'success' : 'neutral'} />
        <Button label={saving ? 'Saving…' : 'Save'} size="sm" onPress={save} loading={saving} disabled={!dirty && !imgState.isUploading} />
      </View>

      {/* Mobile hero card */}
      <View style={s.mobileHero}>
        {coverUri ? (
          <Image source={{ uri: coverUri }} style={s.mobileHeroImage} resizeMode="cover" />
        ) : (
          <View style={s.mobileHeroPlaceholder}>
            <Ionicons name="image-outline" size={24} color={t.color.textMuted} />
          </View>
        )}
        <View style={s.mobileHeroInfo}>
          <Text variant="label" numberOfLines={1}>{p.title}</Text>
          <Text variant="small" muted>{currency} {fmt(p.price_cents)} · {p.stock_quantity} in stock</Text>
          <View style={s.mobileHeroPills}>
            <Badge label={p.visibility} tone="neutral" />
            {p.featured && <Badge label="Featured" tone="accent" />}
          </View>
        </View>
      </View>

      {/* Accordion groups */}
      {GROUPS.map(g => (
        <Group key={g.id} icon={g.icon} label={g.label} summary={groupSummary(g.id)} defaultOpen={g.id === 'basics'}>
          {renderGroupContent(g.id)}
        </Group>
      ))}

      {/* Floating save bar */}
      {(dirty || imgState.isUploading) && (
        <View style={s.saveBar}>
          <Button label={imgState.isUploading ? 'Waiting for uploads…' : saving ? 'Saving…' : 'Save changes'} size="sm" onPress={save} loading={saving} disabled={imgState.isUploading} style={s.flex1} />
          <Button label="Discard" size="sm" variant="ghost" onPress={() => { setDraft({}); setDirty(false); }} disabled={saving} />
        </View>
      )}
    </Screen>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (t: ReturnType<typeof useTheme>) => ({
  flex1: { flex: 1 },

  // Shared
  pillRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
  hidden: { display: 'none' as const },

  // ImageRow
  imageScroll: { height: 80 },
  imageSlotRow: { flexDirection: 'row' as const, gap: t.space.sm },
  imageSlot: { width: 80, height: 80, borderRadius: t.radius.md, overflow: 'hidden' as const },
  imageThumb: { width: 80, height: 80 },
  imageOverlay: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center' as const, justifyContent: 'center' as const },
  imageOverlayError: { backgroundColor: 'rgba(220,38,38,0.6)' },
  imageAdd: { width: 80, height: 80, borderRadius: t.radius.md, backgroundColor: t.color.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  coverBadge: { position: 'absolute' as const, top: 4, left: 4, backgroundColor: t.color.primary, borderRadius: t.radius.sm, padding: 3 },

  // Group accordion (mobile)
  group: { gap: t.space.md },
  groupHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.md, paddingVertical: t.space.sm },
  groupHeaderText: { flex: 1, gap: 2 },
  groupBody: { gap: t.space.md },
  groupContentWrap: { gap: t.space.md },

  // Image card inside group body
  imageSection: { backgroundColor: t.color.surface, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.color.border, padding: t.space.lg, gap: t.space.sm },

  // VariantRow
  variantRow: { borderBottomWidth: 1, borderColor: t.color.border },
  variantHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, minHeight: 56, paddingHorizontal: t.space.lg, gap: t.space.md },
  variantTitle: { flex: 1 },
  variantBody: { paddingHorizontal: t.space.lg, paddingBottom: t.space.md, gap: t.space.md },
  variantActions: { flexDirection: 'row' as const, gap: t.space.sm },

  // AddVariantForm
  addVariantForm: { paddingHorizontal: t.space.lg, paddingVertical: t.space.md, gap: t.space.md },
  addVariantDim: { gap: t.space.xs },

  // Header (shared mobile/desktop)
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.md },
  headerBack: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },

  // Stock status row
  stockStatusRow: { flexDirection: 'row' as const, alignItems: 'center' as const, minHeight: 56, paddingHorizontal: t.space.lg, gap: t.space.md },

  // Toggle block inside a GroupedCard
  toggleContainer: { paddingHorizontal: t.space.lg },

  // Add variant toggle link
  addVariantToggle: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },

  // Empty variants placeholder
  noVariants: { paddingHorizontal: t.space.lg, paddingVertical: t.space.md },

  // Floating save bar (mobile)
  saveBar: { flexDirection: 'row' as const, gap: t.space.md },

  // Desktop two-column layout
  desktopBody: { flex: 1, flexDirection: 'row' as const, gap: t.space.xl },
  desktopSidebar: { width: 220, gap: 2 },
  desktopContent: { flex: 1 },
  desktopContentInner: { gap: t.space.lg, paddingBottom: t.space.xl },
  desktopHero: {
    borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.color.border,
    overflow: 'hidden' as const, backgroundColor: t.color.surface, marginBottom: t.space.md,
  },
  desktopHeroImage: { width: '100%' as const, aspectRatio: 1, backgroundColor: t.color.surfaceAlt },
  desktopHeroPlaceholder: {
    width: '100%' as const, aspectRatio: 1, backgroundColor: t.color.surfaceAlt,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  desktopHeroInfo: { padding: t.space.md, gap: 4 },
  sidebarItem: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm,
    paddingVertical: t.space.sm, paddingHorizontal: t.space.md, borderRadius: t.radius.md,
  },
  sidebarItemActive: { backgroundColor: t.color.surfaceAlt },

  // Mobile hero card
  mobileHero: {
    flexDirection: 'row' as const, gap: t.space.md,
    backgroundColor: t.color.surface, borderRadius: t.radius.lg,
    borderWidth: 1, borderColor: t.color.border, padding: t.space.md,
  },
  mobileHeroImage: { width: 64, height: 64, borderRadius: t.radius.md, backgroundColor: t.color.surfaceAlt },
  mobileHeroPlaceholder: {
    width: 64, height: 64, borderRadius: t.radius.md, backgroundColor: t.color.surfaceAlt,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  mobileHeroInfo: { flex: 1, gap: 4 },
  mobileHeroPills: { flexDirection: 'row' as const, gap: t.space.sm, flexWrap: 'wrap' as const },
});
