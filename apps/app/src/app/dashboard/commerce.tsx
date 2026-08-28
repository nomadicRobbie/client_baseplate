import { useEffect, useState, useCallback } from 'react';
import { View, Pressable, Image, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useImageSlots, type ImageSlot, type UploadFn } from '@/lib/image-slots';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Product } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listAdminProducts, createProduct, updateProduct, uploadProductImage } from '@/lib/api';
import { Screen, Text, Card, Button, Toggle, Pill, GroupedCard, FieldRow } from '@/ui/components';
import { useTheme } from '@/theme';
import { useProfile } from '@/lib/profile-context';

function fmt(cents: number) { return (cents / 100).toFixed(2); }
function primaryImage(p: Product): string | null { return p.media?.primary_image ?? null; }

// ── Image row ────────────────────────────────────────────────────────────────
function ImageRow({ slots, onAdd, onRetry }: { slots: ImageSlot[]; onAdd: () => void; onRetry: (id: string) => void }) {
  const t = useTheme();
  const s = makeStyles(t);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: 80 }}>
      <View style={s.thumbRow}>
        {slots.map(slot => (
          <Pressable key={slot.id} onPress={slot.status === 'error' ? () => onRetry(slot.id) : undefined} style={s.thumbWrapper}>
            <Image source={{ uri: slot.localUri }} style={s.thumb} resizeMode="cover" />
            {slot.status === 'uploading' && <View style={s.thumbOverlay}><ActivityIndicator size="small" color="#fff" /></View>}
            {slot.status === 'error' && <View style={[s.thumbOverlay, s.thumbError]}><Ionicons name="refresh" size={20} color="#fff" /></View>}
          </Pressable>
        ))}
        <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel="Add image" style={s.thumbAdd}>
          <Ionicons name="add" size={28} color={t.color.textMuted} />
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ── Product card ──────────────────────────────────────────────────────────────
function ProductCard({ product, onPress, onToggleActive }: {
  product: Product; onPress: () => void; onToggleActive: () => void;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  return (
    <View style={s.cardWrapper}>
      <Pressable onPress={onPress} style={({ pressed }) => [s.card, { opacity: pressed ? 0.85 : 1 }]}>
        {primaryImage(product) ? (
          <Image source={{ uri: primaryImage(product)! }} style={s.cardImage} resizeMode="cover" />
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
            <Text variant="small" muted>{product.stock_quantity} in stock</Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (t: ReturnType<typeof useTheme>) => ({
  cardWrapper: { flex: 1 },
  card: { borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.color.border, overflow: 'hidden' as const, backgroundColor: t.color.surface },
  cardImage: { width: '100%' as const, aspectRatio: 1, backgroundColor: t.color.surfaceAlt },
  cardImagePlaceholder: { width: '100%' as const, aspectRatio: 1, backgroundColor: t.color.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  activeDot: { position: 'absolute' as const, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 99, padding: 6 },
  activeDotInner: { width: 8, height: 8, borderRadius: 4 },
  cardInfo: { gap: 2 },
  cardFooter: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  thumbRow: { flexDirection: 'row' as const, gap: t.space.sm },
  thumbWrapper: { width: 80, height: 80, borderRadius: t.radius.md, overflow: 'hidden' as const },
  thumb: { width: 80, height: 80 } as const,
  thumbOverlay: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center' as const, justifyContent: 'center' as const },
  thumbError: { backgroundColor: 'rgba(220,38,38,0.6)' },
  thumbAdd: { width: 80, height: 80, borderRadius: t.radius.md, backgroundColor: t.color.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  sizeGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
  screenHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  titleSection: { gap: 2 },
  headerButtons: { flexDirection: 'row' as const, gap: t.space.sm },
  productsContainer: { gap: t.space.md },
  productRow: { flexDirection: 'row' as const, gap: t.space.md },
  flex1: { flex: 1 },
  spacer: { flex: 1 },
  priceRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  textInput: { backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14 },
  togglesContainer: { gap: t.space.xs },
  buttonRow: { flexDirection: 'row' as const, gap: t.space.md },
  fieldGroup: { gap: t.space.xs },
});

// ── Add product form ──────────────────────────────────────────────────────────
const COMMON_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One size'];

function AddProductForm({ currency, onAdded, onCancel, onToast }: {
  currency: string; onAdded: (p: Product) => void; onCancel: () => void; onToast: (text: string, tone: 'success' | 'error') => void;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  const [title, setTitle]                       = useState('');
  const [price, setPrice]                       = useState('');
  const [sizes, setSizes]                       = useState<string[]>([]);
  const [requiresShipping, setRequiresShipping] = useState(true);
  const [active, setActive]                     = useState(true);
  const [busy, setBusy]                         = useState(false);

  const uploadFn: UploadFn = (f) => uploadProductImage(getAccessToken()!, f);
  const { slots, pick, retrySlot, doneUrls, isUploading } = useImageSlots([], (msg) => onToast(msg, 'error'));
  const toggleSize = (sz: string) => setSizes(prev => prev.includes(sz) ? prev.filter(x => x !== sz) : [...prev, sz]);

  const submit = async () => {
    if (!title.trim()) { onToast('Title is required', 'error'); return; }
    const priceCents = Math.round(parseFloat(price) * 100);
    if (isNaN(priceCents) || priceCents < 0) { onToast('Enter a valid price', 'error'); return; }
    setBusy(true);
    try {
      const { product } = await createProduct(getAccessToken()!, {
        title: title.trim(), description: '', price_cents: priceCents,
        media: { primary_image: doneUrls[0] ?? null, gallery: doneUrls },
        shipping_info: { requires_shipping: requiresShipping },
        variant_options: sizes.length ? { option_names: ['Size'], options: { Size: sizes } } : {},
        has_variants: sizes.length > 0,
        stock_quantity: 0, stock_status: 'in_stock' as const,
        status: 'active' as const, visibility: 'public' as const, product_type: 'physical' as const,
        active, sku: null, slug: null, handle: null, parent_id: null, gtin: null, mpn: null,
        featured: false, is_digital: false, compare_at_price_cents: null, cost_price_cents: null,
        currency, tax_class: null, tax_inclusive: true, track_inventory: true, allow_backorder: false,
        low_stock_threshold: null, warehouse_location: null, lead_time_days: null, restock_date: null,
        rating_average: null, rating_count: 0, sales_channels: [], available_regions: [],
        content: {}, specifications: {}, organisation: {}, seo: {},
        social_proof: {}, pricing_meta: {}, digital_product: {}, compliance: {}, published_at: null,
      });
      onAdded(product);
    } catch (e) { onToast(e instanceof Error ? e.message : 'Failed to create product', 'error'); }
    finally { setBusy(false); }
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
          <Text variant="label" muted>Sizes (optional)</Text>
          <View style={s.sizeGrid}>
            {COMMON_SIZES.map(sz => <Pill key={sz} label={sz} active={sizes.includes(sz)} onPress={() => toggleSize(sz)} />)}
          </View>
        </View>
      </Card>
      <Card>
        <Text variant="heading">Cover</Text>
        <ImageRow slots={slots} onAdd={() => void pick(uploadFn, (msg) => onToast(msg, 'error'))} onRetry={(id) => retrySlot(id, uploadFn)} />
        <View style={s.togglesContainer}>
          <Toggle value={requiresShipping} onChange={setRequiresShipping} label="Can be delivered" />
          <Toggle value={active} onChange={setActive} label="Visible in shop" />
        </View>
      </Card>
      <View style={s.buttonRow}>
        <Button label={isUploading ? 'Waiting for uploads…' : 'Add product'} onPress={submit} loading={busy} disabled={isUploading} style={s.flex1} />
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
  const router = useRouter();
  const { features } = useAuth();
  const { data: profile } = useProfile();
  const currency = profile?.org?.currency ?? process.env.EXPO_PUBLIC_CURRENCY ?? 'NZD';
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [adding, setAdding]     = useState(false);

  const showToast = useCallback((text: string, tone: 'success' | 'error') => setToast({ text, tone }), []);

  const load = useCallback(async () => {
    setLoading(true);
    try { setProducts((await listAdminProducts(getAccessToken()!)).products); }
    catch (e) { setToast({ text: e instanceof Error ? e.message : 'Failed to load products', tone: 'error' }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (features && !features.commerce) return <Redirect href="/dashboard" />;

  const activeCount   = products.filter(p => p.active).length;
  const inactiveCount = products.filter(p => !p.active).length;

  const handleToggleActive = async (product: Product) => {
    try {
      const { product: updated } = await updateProduct(getAccessToken()!, product.id, { active: !product.active });
      setProducts(prev => prev.map(p => p.id === updated.id ? updated : p));
    } catch { /* silent */ }
  };

  const handleAdded = (product: Product) => {
    setProducts(prev => [product, ...prev]);
    setAdding(false);
    router.push(`/dashboard/commerce/${product.id}` as never);
  };

  const rows: Product[][] = [];
  for (let i = 0; i < products.length; i += COLS) rows.push(products.slice(i, i + COLS));

  return (
    <Screen toast={toast} onDismissToast={() => setToast(null)}>
      <View style={s.screenHeader}>
        <View style={s.titleSection}>
          <Text variant="title">Store</Text>
          {!loading && <Text muted>{activeCount} active · {inactiveCount} inactive</Text>}
        </View>
        <View style={s.headerButtons}>
          <Button label="Refresh" variant="ghost" onPress={load} loading={loading} />
          {!adding && <Button label="Add product" onPress={() => setAdding(true)} />}
        </View>
      </View>

      {adding && <AddProductForm currency={currency} onAdded={handleAdded} onCancel={() => setAdding(false)} onToast={showToast} />}

      {loading ? (
        <Text muted>Loading products…</Text>
      ) : products.length === 0 ? (
        <Text muted>No products yet. Add one above.</Text>
      ) : (
        <View style={s.productsContainer}>
          {rows.map((row, i) => (
            <View key={i} style={s.productRow}>
              {row.map(product => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onPress={() => router.push(`/dashboard/commerce/${product.id}` as never)}
                  onToggleActive={() => handleToggleActive(product)}
                />
              ))}
              {row.length < COLS && <View style={s.spacer} />}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
