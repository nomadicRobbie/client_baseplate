import { useEffect, useState, useCallback } from 'react';
import { View, Pressable, Image, TextInput, Platform, ScrollView } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Product } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listAdminProducts, createProduct, updateProduct, uploadProductImage } from '@/lib/api';
import { Screen, Text, Card, Button, Toggle, Pill, Stepper, GroupedCard, FieldRow } from '@/ui/components';
import { useTheme } from '@/theme';
import { useProfile } from '@/lib/profile-context';

function fmt(cents: number) {
  return (cents / 100).toFixed(2);
}

// ── Stock editor ──────────────────────────────────────────────────────────────
function StockEditor({ sizes, stockLevel, onChange }: {
  sizes: string[];
  stockLevel: Record<string, number>;
  onChange: (sl: Record<string, number>) => void;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  if (!sizes.length) return null;

  // Normalise stock_level keys to lowercase so lookup is case-insensitive
  const normalised = Object.fromEntries(
    Object.entries(stockLevel).map(([k, v]) => [k.toLowerCase(), v])
  );

  const get = (size: string) => normalised[size.toLowerCase()] ?? 0;

  const set = (size: string, val: number) => {
    // Rebuild preserving all existing keys (normalised), then update target
    const updated = { ...normalised, [size.toLowerCase()]: val };
    onChange(updated);
  };

  return (
    <View style={s.stockContainer}>
      {sizes.map(size => (
        <View key={size} style={s.stockRow}>
          <Text variant="label" style={s.stockSize}>{size.toUpperCase()}</Text>
          <Stepper value={get(size)} onChange={(v) => set(size, v)} min={0} />
        </View>
      ))}
    </View>
  );
}

// ── Image row ────────────────────────────────────────────────────────────────
function ImageRow({ images, onAdd, uploading }: { images: string[]; onAdd: () => void; uploading: boolean }) {
  const t = useTheme();
  const s = makeStyles(t);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={s.thumbRow}>
        {images.map((uri, i) => (
          <Image key={i} source={{ uri }} style={s.thumb} resizeMode="cover" />
        ))}
        <Pressable onPress={onAdd} disabled={uploading} accessibilityRole="button" accessibilityLabel="Add image" style={s.thumbAdd}>
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
  const [draft, setDraft] = useState({
    ...product,
    images: product.images.length ? product.images : product.image_url ? [product.image_url] : [],
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(product);

  const save = async () => {
    setBusy(true);
    try {
      const { product: updated } = await updateProduct(getAccessToken()!, product.id, {
        title: draft.title, price_cents: draft.price_cents, stock_level: draft.stock_level,
        active: draft.active, is_new: draft.is_new, postable: draft.postable,
        image_url: draft.images[0] ?? null, images: draft.images,
      });
      onSaved(updated);
      onToast('Saved', 'success');
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally { setBusy(false); }
  };

  const pickImage = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
      input.onchange = async () => {
        const file = input.files?.[0]; if (!file) return;
        setUploading(true);
        try {
          const { url } = await uploadProductImage(getAccessToken()!, file);
          setDraft(d => { const imgs = [...d.images, url]; return { ...d, images: imgs, image_url: imgs[0] }; });
        }
        catch (e) { onToast(e instanceof Error ? e.message : 'Upload failed', 'error'); }
        finally { setUploading(false); }
      };
      input.click();
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { onToast('Photo library access is required.', 'error'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.6 });
      if (result.canceled) return;
      setUploading(true);
      try {
        const { url } = await uploadProductImage(getAccessToken()!, result.assets[0].uri);
        setDraft(d => { const imgs = [...d.images, url]; return { ...d, images: imgs, image_url: imgs[0] }; });
      }
      catch (e) { onToast(e instanceof Error ? e.message : 'Upload failed', 'error'); }
      finally { setUploading(false); }
    }
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

        {draft.sizes.length > 0 && (
          <View style={s.fieldGroup}>
            <Text variant="label" muted>Sizes *</Text>
            <View style={s.sizeGrid}>
              {draft.sizes.map(sz => <Pill key={sz} label={sz.toUpperCase()} active onPress={() => {}} />)}
            </View>
          </View>
        )}

        <View style={s.fieldGroup}>
          <Text variant="label" muted>Stock per size</Text>
          {draft.sizes.length > 0 ? (
            <StockEditor sizes={draft.sizes} stockLevel={draft.stock_level as Record<string, number>}
              onChange={sl => setDraft(d => ({ ...d, stock_level: sl }))} />
          ) : (
            <TextInput
              value={String(Object.values(draft.stock_level as Record<string, number>).reduce((a, b) => a + b, 0))}
              onChangeText={v => { const n = parseInt(v, 10); if (!isNaN(n) && n >= 0) setDraft(d => ({ ...d, stock_level: { total: n } })); }}
              keyboardType="number-pad"
              style={[s.textInput, { width: 100 }]} />
          )}
        </View>
      </Card>

      <Card>
        <Text variant="heading">Cover</Text>
        <ImageRow images={draft.images} onAdd={pickImage} uploading={uploading} />

        <View style={s.togglesContainer}>
          <Toggle value={!!draft.postable} onChange={() => setDraft(d => ({ ...d, postable: !d.postable }))} label="Postable" />
          <Toggle value={!!draft.active} onChange={() => setDraft(d => ({ ...d, active: !d.active }))} label="Visible in shop" />
        </View>
      </Card>

      <View style={s.buttonRow}>
        <Button label="Save product" onPress={save} loading={busy} disabled={!dirty} style={s.flex1} />
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

  const totalStock = typeof product.stock_level === 'object' && product.stock_level !== null
    ? Object.values(product.stock_level as Record<string, number>).reduce((a, b) => a + b, 0)
    : null;

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
        {product.image_url ? (
          <Image source={{ uri: product.image_url }} style={s.cardImage} resizeMode="cover" />
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
            {totalStock !== null && <Text variant="small" muted>{totalStock} in stock</Text>}
          </View>
        </View>
      </Pressable>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const makeStyles = (t: ReturnType<typeof useTheme>) => ({
  // Stock editor
  stockContainer: { gap: t.space.xs } as const,
  stockRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  stockSize: { minWidth: 48 },

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
  thumb: { width: 80, height: 80, borderRadius: t.radius.md } as const,
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
  const [title, setTitle]               = useState('');
  const [price, setPrice]               = useState('');
  const [images, setImages]             = useState<string[]>([]);
  const [sizes, setSizes]               = useState<string[]>([]);
  const [stockLevel, setStockLevel]     = useState<Record<string, number>>({});
  const [postable, setPostable]         = useState(true);
  const [active, setActive]             = useState(true);
  const [busy, setBusy]                 = useState(false);
  const [uploading, setUploading]       = useState(false);

  const toggleSize = (sz: string) => {
    if (sizes.includes(sz)) {
      setSizes(prev => prev.filter(x => x !== sz));
      setStockLevel(prev => { const next = { ...prev }; delete next[sz]; return next; });
    } else {
      setSizes(prev => [...prev, sz]);
      setStockLevel(prev => ({ ...prev, [sz]: 0 }));
    }
  };

  const pickImage = async () => {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
      input.onchange = async () => {
        const file = input.files?.[0]; if (!file) return;
        setUploading(true);
        try { const { url } = await uploadProductImage(getAccessToken()!, file); setImages(prev => [...prev, url]); }
        catch (e) { onToast(e instanceof Error ? e.message : 'Upload failed', 'error'); }
        finally { setUploading(false); }
      };
      input.click();
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { onToast('Photo library access is required.', 'error'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.6 });
      if (result.canceled) return;
      setUploading(true);
      try { const { url } = await uploadProductImage(getAccessToken()!, result.assets[0].uri); setImages(prev => [...prev, url]); }
      catch (e) { onToast(e instanceof Error ? e.message : 'Upload failed', 'error'); }
      finally { setUploading(false); }
    }
  };

  const submit = async () => {
    if (!title.trim()) { onToast('Title is required', 'error'); return; }
    const priceCents = Math.round(parseFloat(price) * 100);
    if (isNaN(priceCents) || priceCents < 0) { onToast('Enter a valid price', 'error'); return; }
    setBusy(true);
    try {
      const { product } = await createProduct(getAccessToken()!, {
        title: title.trim(), description: '', desc_points: [], price_cents: priceCents,
        image_url: images[0] ?? null, images,
        sizes, stock_level: stockLevel, postable, is_new: false,
        model_size: false, model_details: [], active,
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

        {sizes.length > 0 && (
          <View style={s.fieldGroup}>
            <Text variant="label" muted>Stock per size</Text>
            <StockEditor sizes={sizes} stockLevel={stockLevel}
              onChange={setStockLevel} />
          </View>
        )}
      </Card>

      <Card>
        <Text variant="heading">Cover</Text>
        <ImageRow images={images} onAdd={pickImage} uploading={uploading} />

        <View style={s.togglesContainer}>
          <Toggle value={postable} onChange={setPostable} label="Postable" />
          <Toggle value={active} onChange={setActive} label="Visible in shop" />
        </View>
      </Card>

      <View style={s.buttonRow}>
        <Button label="Add product" onPress={submit} loading={busy} style={s.flex1} />
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
