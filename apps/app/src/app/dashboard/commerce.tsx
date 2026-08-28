import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Pressable, Image, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useImageSlots, type ImageSlot, type UploadFn } from '@/lib/image-slots';
import { Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Product } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listAdminProducts, createProduct, updateProduct, uploadProductImage } from '@/lib/api';
import { Screen, Text, Card, Button, Toggle, Pill, GroupedCard, FieldRow } from '@/ui/components';
import { useTheme } from '@/theme';
import { useProfile } from '@/lib/profile-context';

function fmt(cents: number) {
  return (cents / 100).toFixed(2);
}

function productPrimaryImage(p: Product): string | null {
  return p.media?.primary_image ?? null;
}

function productGallery(p: Product): string[] {
  return p.media?.gallery ?? [];
}

function productSizes(p: Product): string[] {
  return p.variant_options?.options?.['Size'] ?? [];
}


// ── Image row ────────────────────────────────────────────────────────────────
function ImageRow({ slots, onAdd, onRetry }: {
  slots: ImageSlot[];
  onAdd: () => void;
  onRetry: (id: string) => void;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: 80 }}>
      <View style={s.thumbRow}>
        {slots.map(slot => (
          <Pressable
            key={slot.id}
            onPress={slot.status === 'error' ? () => onRetry(slot.id) : undefined}
            style={s.thumbWrapper}
          >
            <Image source={{ uri: slot.localUri }} style={s.thumb} resizeMode="cover" />
            {slot.status === 'uploading' && (
              <View style={s.thumbOverlay}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            )}
            {slot.status === 'error' && (
              <View style={[s.thumbOverlay, s.thumbError]}>
                <Ionicons name="refresh" size={20} color="#fff" />
              </View>
            )}
          </Pressable>
        ))}
        <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel="Add image" style={s.thumbAdd}>
          <Ionicons name="add" size={28} color={t.color.textMuted} />
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ── Edit sheet ────────────────────────────────────────────────────────────────
function EditSheet({ product, currency, onSaved, onClose, onToast }: {
  product: Product;
  currency: string;
  onSaved: (p: Product) => void;
  onClose: () => void;
  onToast: (text: string, tone: 'success' | 'error') => void;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  const [draft, setDraft] = useState(product);
  const [busy, setBusy] = useState(false);

  const initialImages = useMemo(
    () => { const g = productGallery(product); return g.length ? g : productPrimaryImage(product) ? [productPrimaryImage(product)!] : []; },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [product.id],
  );
  const uploadFn: UploadFn = (f) => uploadProductImage(getAccessToken()!, f);
  const { slots, pick, retrySlot, doneUrls, isUploading } = useImageSlots(initialImages, (msg) => onToast(msg, 'error'));

  const fieldsDirty = draft.title !== product.title ||
    draft.price_cents !== product.price_cents ||
    draft.stock_quantity !== product.stock_quantity ||
    draft.active !== product.active ||
    draft.shipping_info?.requires_shipping !== product.shipping_info?.requires_shipping;
  const imagesDirty = JSON.stringify(doneUrls) !== JSON.stringify(initialImages);
  const dirty = fieldsDirty || imagesDirty;

  const save = async () => {
    setBusy(true);
    try {
      const { product: updated } = await updateProduct(getAccessToken()!, product.id, {
        title: draft.title,
        price_cents: draft.price_cents,
        stock_quantity: draft.stock_quantity,
        active: draft.active,
        shipping_info: { ...draft.shipping_info, requires_shipping: draft.shipping_info?.requires_shipping ?? true },
        media: { ...draft.media, primary_image: doneUrls[0] ?? null, gallery: doneUrls },
      });
      onSaved(updated);
      onToast('Saved', 'success');
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally { setBusy(false); }
  };

  return (
    <>
      <Card>
        <View style={s.editHeader}>
          <Text variant="heading">Edit product</Text>
          <Pressable onPress={onClose} style={s.editClose}>
            <Ionicons name="close" size={20} color={t.color.textMuted} />
          </Pressable>
        </View>

        <GroupedCard>
          <FieldRow label="Product name" displayValue={draft.title}>
            <TextInput value={draft.title} onChangeText={v => setDraft(d => ({ ...d, title: v }))} style={s.textInput} />
          </FieldRow>
          <FieldRow label="Price" displayValue={`${currency} ${fmt(draft.price_cents)}`} last>
            <View style={s.priceRow}>
              <Text variant="label" muted>{currency}</Text>
              <TextInput
                value={fmt(draft.price_cents)}
                onChangeText={v => { const n = parseFloat(v); if (!isNaN(n)) setDraft(d => ({ ...d, price_cents: Math.round(n * 100) })); }}
                keyboardType="decimal-pad"
                style={[s.textInput, s.flex1]} />
            </View>
          </FieldRow>
        </GroupedCard>

        {productSizes(draft).length > 0 && (
          <View style={s.fieldGroup}>
            <Text variant="label" muted>Sizes</Text>
            <View style={s.sizeGrid}>
              {productSizes(draft).map(sz => <Pill key={sz} label={sz.toUpperCase()} active onPress={() => {}} />)}
            </View>
          </View>
        )}

        <View style={s.fieldGroup}>
          <Text variant="label" muted>Total stock</Text>
          <TextInput
            value={String(draft.stock_quantity)}
            onChangeText={v => { const n = parseInt(v, 10); if (!isNaN(n) && n >= 0) setDraft(d => ({ ...d, stock_quantity: n })); }}
            keyboardType="number-pad"
            style={[s.textInput, { width: 100 }]} />
        </View>
      </Card>

      <Card>
        <Text variant="heading">Cover</Text>
        <ImageRow
          slots={slots}
          onAdd={() => void pick(uploadFn, (msg) => onToast(msg, 'error'))}
          onRetry={(id) => retrySlot(id, uploadFn)}
        />
        <View style={s.togglesContainer}>
          <Toggle
            value={draft.shipping_info?.requires_shipping ?? true}
            onChange={() => setDraft(d => ({ ...d, shipping_info: { ...d.shipping_info, requires_shipping: !(d.shipping_info?.requires_shipping ?? true) } }))}
            label="Can be delivered"
          />
          <Toggle value={!!draft.active} onChange={() => setDraft(d => ({ ...d, active: !d.active }))} label="Visible in shop" />
        </View>
      </Card>

      <View style={s.buttonRow}>
        <Button
          label={isUploading ? 'Waiting for uploads…' : 'Save product'}
          onPress={save} loading={busy} disabled={!dirty || isUploading} style={s.flex1}
        />
        <Button label="Discard" variant="ghost" onPress={() => setDraft(product)} disabled={!dirty || busy} />
      </View>
    </>
  );
}

// ── Product card ──────────────────────────────────────────────────────────────
function ProductCard({ product, selected, onSelect, onToggleActive }: {
  product: Product;
  selected: boolean;
  onSelect: () => void;
  onToggleActive: () => void;
}) {
  const t = useTheme();
  const s = makeStyles(t);

  const totalStock = product.stock_quantity;

  return (
    <View style={s.cardWrapper}>
      <Pressable
        onPress={onSelect}
        style={({ pressed }) => [
          s.card,
          {
            backgroundColor: selected ? t.color.surfaceAlt : t.color.surface,
            borderColor: selected ? t.color.primary : t.color.border,
            opacity: pressed ? 0.85 : 1,
          }
        ]}
      >
        {productPrimaryImage(product) ? (
          <Image source={{ uri: productPrimaryImage(product)! }} style={s.cardImage} resizeMode="cover" />
        ) : (
          <View style={s.cardImagePlaceholder}>
            <Ionicons name="image-outline" size={36} color={t.color.textMuted} />
          </View>
        )}

        <Pressable
          onPress={(e) => { e.stopPropagation?.(); onToggleActive(); }}
          style={[s.activeDot, { top: t.space.sm, right: t.space.sm }]}
          accessibilityLabel={product.active ? 'Active — tap to deactivate' : 'Inactive — tap to activate'}
        >
          <View style={[s.activeDotInner, { backgroundColor: product.active ? '#4ade80' : '#f87171' }]} />
        </Pressable>

        <View style={[s.cardInfo, { padding: t.space.md }]}>
          <Text variant="label">{product.title}</Text>
          <View style={s.cardFooter}>
            <Text variant="small" muted>${fmt(product.price_cents)}</Text>
            <Text variant="small" muted>{totalStock} in stock</Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (t: ReturnType<typeof useTheme>) => ({
  // Edit sheet
  editHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  editClose: { padding: t.space.sm },
  priceRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  fieldGroup: { gap: t.space.xs },
  textInput: { backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14 },
  togglesContainer: { gap: t.space.xs },
  buttonRow: { flexDirection: 'row' as const, gap: t.space.md },

  // Product card
  cardWrapper: { flex: 1 },
  card: { borderRadius: t.radius.lg, borderWidth: 2, overflow: 'hidden' as const },
  cardImage: { width: '100%' as const, aspectRatio: 1, backgroundColor: t.color.surfaceAlt },
  cardImagePlaceholder: { width: '100%' as const, aspectRatio: 1, backgroundColor: t.color.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  activeDot: { position: 'absolute' as const, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 99, padding: 6 },
  activeDotInner: { width: 8, height: 8, borderRadius: 4 },
  cardInfo: { gap: 2 },
  cardFooter: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },

  // Image row
  thumbRow: { flexDirection: 'row' as const, gap: t.space.sm },
  thumbWrapper: { width: 80, height: 80, borderRadius: t.radius.md, overflow: 'hidden' as const },
  thumb: { width: 80, height: 80 } as const,
  thumbOverlay: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center' as const, justifyContent: 'center' as const },
  thumbError: { backgroundColor: 'rgba(220,38,38,0.6)' },
  thumbAdd: { width: 80, height: 80, borderRadius: t.radius.md, backgroundColor: t.color.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },

  // Add product form
  sizeGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },

  // Main screen
  screenHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  titleSection: { gap: 2 },
  headerButtons: { flexDirection: 'row' as const, gap: t.space.sm },
  productsContainer: { gap: t.space.md },
  productRow: { flexDirection: 'row' as const, gap: t.space.md },
  flex1: { flex: 1 },
  spacer: { flex: 1 },
});

// ── Add product form ──────────────────────────────────────────────────────────
const COMMON_SIZES = ['xs', 's', 'm', 'l', 'xl', 'xxl', 'one-size'];

function AddProductForm({ currency, onAdded, onCancel, onToast }: { currency: string; onAdded: (p: Product) => void; onCancel: () => void; onToast: (text: string, tone: 'success' | 'error') => void }) {
  const t = useTheme();
  const s = makeStyles(t);
  const [title, setTitle]                   = useState('');
  const [price, setPrice]                   = useState('');
  const [sizes, setSizes]                   = useState<string[]>([]);
  const [requiresShipping, setRequiresShipping] = useState(true);
  const [active, setActive]                 = useState(true);
  const [busy, setBusy]                     = useState(false);

  const uploadFn: UploadFn = (f) => uploadProductImage(getAccessToken()!, f);
  const { slots, pick, retrySlot, doneUrls, isUploading } = useImageSlots([], (msg) => onToast(msg, 'error'));

  const toggleSize = (sz: string) =>
    setSizes(prev => prev.includes(sz) ? prev.filter(x => x !== sz) : [...prev, sz]);

  const submit = async () => {
    if (!title.trim()) { onToast('Title is required', 'error'); return; }
    const priceCents = Math.round(parseFloat(price) * 100);
    if (isNaN(priceCents) || priceCents < 0) { onToast('Enter a valid price', 'error'); return; }
    setBusy(true);
    try {
      const { product } = await createProduct(getAccessToken()!, {
        title: title.trim(),
        description: '',
        price_cents: priceCents,
        media: { primary_image: doneUrls[0] ?? null, gallery: doneUrls },
        shipping_info: { requires_shipping: requiresShipping },
        variant_options: sizes.length ? { option_names: ['Size'], options: { Size: sizes } } : {},
        has_variants: sizes.length > 0,
        stock_quantity: 0,
        stock_status: 'in_stock' as const,
        status: 'active' as const,
        visibility: 'public' as const,
        product_type: 'physical' as const,
        active,
        // required defaults
        sku: null, slug: null, handle: null, parent_id: null, gtin: null, mpn: null,
        featured: false, is_digital: false,
        compare_at_price_cents: null, cost_price_cents: null, currency: currency,
        tax_class: null, tax_inclusive: true,
        track_inventory: true, allow_backorder: false, low_stock_threshold: null,
        warehouse_location: null, lead_time_days: null, restock_date: null,
        rating_average: null, rating_count: 0,
        sales_channels: [], available_regions: [],
        content: {}, specifications: {}, organisation: {}, seo: {},
        social_proof: {}, pricing_meta: {}, digital_product: {}, compliance: {},
        published_at: null,
      });
      onAdded(product);
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Failed to create product', 'error');
    } finally { setBusy(false); }
  };

  return (
    <>
      <Card>
        <Text variant="heading">New product</Text>

        <GroupedCard>
          <FieldRow label="Product name" displayValue={title}>
            <TextInput value={title} onChangeText={setTitle} placeholder="Product name"
              placeholderTextColor={t.color.textMuted} style={s.textInput} />
          </FieldRow>
          <FieldRow label="Price" displayValue={price ? `${currency} ${price}` : ''} last>
            <View style={s.priceRow}>
              <Text variant="label" muted>{currency}</Text>
              <TextInput value={price} onChangeText={setPrice} placeholder="0.00" keyboardType="decimal-pad"
                placeholderTextColor={t.color.textMuted} style={[s.textInput, s.flex1]} />
            </View>
          </FieldRow>
        </GroupedCard>

        <View style={s.fieldGroup}>
          <Text variant="label" muted>Sizes *</Text>
          <View style={s.sizeGrid}>
            {COMMON_SIZES.map(sz => (
              <Pill key={sz} label={sz.toUpperCase()} active={sizes.includes(sz)} onPress={() => toggleSize(sz)} />
            ))}
          </View>
        </View>

      </Card>

      <Card>
        <Text variant="heading">Cover</Text>
        <ImageRow
          slots={slots}
          onAdd={() => void pick(uploadFn, (msg) => onToast(msg, 'error'))}
          onRetry={(id) => retrySlot(id, uploadFn)}
        />
        <View style={s.togglesContainer}>
          <Toggle value={requiresShipping} onChange={setRequiresShipping} label="Can be delivered" />
          <Toggle value={active} onChange={setActive} label="Visible in shop" />
        </View>
      </Card>

      <View style={s.buttonRow}>
        <Button
          label={isUploading ? 'Waiting for uploads…' : 'Add product'}
          onPress={submit} loading={busy} disabled={isUploading} style={s.flex1}
        />
        <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={busy} />
      </View>
    </>
  );
}

// ── Store screen ──────────────────────────────────────────────────────────────
const COLS = 2;

export default function Commerce() {
  const t = useTheme();
  const s = makeStyles(t);
  const { features } = useAuth();
  const { data: profile } = useProfile();
  const currency = profile?.org?.currency ?? process.env.EXPO_PUBLIC_CURRENCY ?? 'NZD';
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [adding, setAdding]     = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const showToast = useCallback((text: string, tone: 'success' | 'error') => setToast({ text, tone }), []);

  const load = useCallback(async () => {
    setLoading(true);
    try { setProducts((await listAdminProducts(getAccessToken()!)).products); }
    catch (e) { setToast({ text: e instanceof Error ? e.message : 'Failed to load products', tone: 'error' }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (features && !features.commerce) return <Redirect href="/dashboard" />;

  const active   = products.filter(p => p.active).length;
  const inactive = products.filter(p => !p.active).length;

  const handleSaved = (updated: Product) =>
    setProducts(prev => prev.map(p => p.id === updated.id ? updated : p));

  const handleToggleActive = async (product: Product) => {
    try {
      const { product: updated } = await updateProduct(getAccessToken()!, product.id, { active: !product.active });
      handleSaved(updated);
    } catch { /* silent */ }
  };

  const handleAdded = (product: Product) => {
    setProducts(prev => [product, ...prev]);
    setAdding(false);
  };

  // Build rows with edit sheet interleaved after the row containing the selected card
  const selectedProduct = products.find(p => p.id === selectedId) ?? null;
  const rows: Array<{ type: 'cards'; items: Product[] } | { type: 'edit' }> = [];
  for (let i = 0; i < products.length; i += COLS) {
    const rowItems = products.slice(i, i + COLS);
    rows.push({ type: 'cards', items: rowItems });
    if (selectedId && rowItems.some(p => p.id === selectedId)) {
      rows.push({ type: 'edit' });
    }
  }

  return (
    <Screen toast={toast} onDismissToast={() => setToast(null)}>
      <View style={s.screenHeader}>
        <View style={s.titleSection}>
          <Text variant="title">Store</Text>
          {!loading && <Text muted>{active} active · {inactive} inactive</Text>}
        </View>
        <View style={s.headerButtons}>
          <Button label="Refresh" variant="ghost" onPress={load} loading={loading} />
          {!adding && <Button label="Add product" onPress={() => { setAdding(true); setSelectedId(null); }} />}
        </View>
      </View>

      {adding && <AddProductForm currency={currency} onAdded={handleAdded} onCancel={() => setAdding(false)} onToast={showToast} />}

      {loading ? (
        <Text muted>Loading products…</Text>
      ) : products.length === 0 ? (
        <Text muted>No products yet. Add one above.</Text>
      ) : (
        <View style={s.productsContainer}>
          {rows.map((row, i) =>
            row.type === 'edit' ? (
              selectedProduct ? (
                <EditSheet
                  key={selectedProduct.id}
                  product={selectedProduct}
                  currency={currency}
                  onSaved={handleSaved}
                  onClose={() => setSelectedId(null)}
                  onToast={showToast}
                />
              ) : null
            ) : (
              <View key={i} style={s.productRow}>
                {row.items.map(product => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    selected={product.id === selectedId}
                    onSelect={() => setSelectedId(id => id === product.id ? null : product.id)}
                    onToggleActive={() => handleToggleActive(product)}
                  />
                ))}
                {row.items.length < COLS && <View style={s.spacer} />}
              </View>
            )
          )}
        </View>
      )}
    </Screen>
  );
}
