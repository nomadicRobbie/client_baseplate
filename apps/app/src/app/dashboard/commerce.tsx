import { useEffect, useState, useCallback } from 'react';
import { View, Pressable, Image, TextInput, Platform, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Product } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listAdminProducts, createProduct, updateProduct, uploadProductImage } from '@/lib/api';
import { Screen, Text, Card, Button, Notice } from '@/ui/components';
import { useTheme } from '@/theme';

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
          <Text variant="small" style={s.stockSize}>{size}</Text>
          <View style={s.stockControls}>
            <Pressable onPress={() => set(size, Math.max(0, get(size) - 1))} style={s.stockButton}>
              <Ionicons name="remove-circle-outline" size={20} color={t.color.textMuted} />
            </Pressable>
            <Text variant="label" style={s.stockValue}>{get(size)}</Text>
            <Pressable onPress={() => set(size, get(size) + 1)} style={s.stockButton}>
              <Ionicons name="add-circle-outline" size={20} color={t.color.primary} />
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Edit sheet ────────────────────────────────────────────────────────────────
function EditSheet({ product, onSaved, onClose }: {
  product: Product;
  onSaved: (p: Product) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  const [draft, setDraft] = useState(product);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(product);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const { product: updated } = await updateProduct(getAccessToken()!, product.id, {
        title: draft.title, price_cents: draft.price_cents, stock_level: draft.stock_level,
        active: draft.active, is_new: draft.is_new, postable: draft.postable, image_url: draft.image_url,
      });
      onSaved(updated);
      setMsg({ text: 'Saved', tone: 'success' });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Save failed', tone: 'error' });
    } finally { setBusy(false); }
  };

  const pickImage = async () => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      setUploading(true);
      try { const { url } = await uploadProductImage(getAccessToken()!, file); setDraft(d => ({ ...d, image_url: url })); }
      catch (e) { setMsg({ text: e instanceof Error ? e.message : 'Upload failed', tone: 'error' }); }
      finally { setUploading(false); }
    };
    input.click();
  };

  return (
    <Card>
      <View style={s.editHeader}>
        <Text variant="heading">{product.title}</Text>
        <Pressable onPress={onClose} style={s.editClose}>
          <Ionicons name="close" size={20} color={t.color.textMuted} />
        </Pressable>
      </View>

      <View style={s.imageContainer}>
        {draft.image_url ? (
          <Image source={{ uri: draft.image_url }} style={s.editImage} resizeMode="cover" />
        ) : (
          <View style={s.imagePlaceholder}>
            <Ionicons name="image-outline" size={28} color={t.color.textMuted} />
          </View>
        )}
        {Platform.OS === 'web' && (
          <Button label={uploading ? 'Uploading…' : 'Change image'} variant="secondary" onPress={pickImage} disabled={uploading} />
        )}
      </View>

      <View style={s.fieldGroup}>
        <Text variant="label" muted>TITLE</Text>
        <TextInput value={draft.title} onChangeText={v => setDraft(d => ({ ...d, title: v }))}
          style={s.textInput} />
      </View>

      <View style={s.fieldGroup}>
        <Text variant="label" muted>PRICE ($)</Text>
        <TextInput
          value={fmt(draft.price_cents)}
          onChangeText={v => { const n = parseFloat(v); if (!isNaN(n)) setDraft(d => ({ ...d, price_cents: Math.round(n * 100) })); }}
          keyboardType="decimal-pad"
          style={s.textInput} />
      </View>

      <View style={s.fieldGroup}>
        <Text variant="label" muted>STOCK</Text>
        {product.sizes.length > 0 ? (
          <StockEditor sizes={draft.sizes} stockLevel={draft.stock_level as Record<string, number>}
            onChange={sl => setDraft(d => ({ ...d, stock_level: sl }))} />
        ) : (
          <TextInput
            value={String(Object.values(draft.stock_level as Record<string, number>).reduce((a, b) => a + b, 0))}
            onChangeText={v => {
              const n = parseInt(v, 10);
              if (!isNaN(n) && n >= 0) setDraft(d => ({ ...d, stock_level: { total: n } }));
            }}
            keyboardType="number-pad"
            style={[s.textInput, { width: 100 }]}
          />
        )}
      </View>

      <View style={s.togglesContainer}>
        {[{ key: 'is_new', label: 'New badge' }, { key: 'postable', label: 'Postable' }].map(({ key, label }) => (
          <Pressable key={key} onPress={() => setDraft(d => ({ ...d, [key]: !d[key as keyof Product] }))}
            style={s.toggleRow}>
            <View style={[s.toggleTrack, { backgroundColor: draft[key as keyof Product] ? t.color.primary : t.color.border }]}>
              <View style={[s.toggleThumb, { alignSelf: draft[key as keyof Product] ? 'flex-end' : 'flex-start' }]} />
            </View>
            <Text variant="small">{label}</Text>
          </Pressable>
        ))}
      </View>

      {msg && <Notice message={msg.text} tone={msg.tone} />}

      <View style={s.buttonRow}>
        <Button label="Save changes" onPress={save} loading={busy} disabled={!dirty} style={s.flex1} />
        <Button label="Discard" variant="ghost" onPress={() => { setDraft(product); setMsg(null); }} disabled={!dirty || busy} />
      </View>
    </Card>
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
  stockSize: { textTransform: 'uppercase' as const, minWidth: 48 },
  stockControls: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  stockButton: { padding: t.space.sm },
  stockValue: { minWidth: 28, textAlign: 'center' as const },

  // Edit sheet
  editHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  editClose: { padding: t.space.sm },
  imageContainer: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.md },
  editImage: { width: 80, height: 80, borderRadius: t.radius.md },
  imagePlaceholder: { width: 80, height: 80, borderRadius: t.radius.md, backgroundColor: t.color.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  fieldGroup: { gap: t.space.xs },
  textInput: { backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14 },
  togglesContainer: { flexDirection: 'row' as const, gap: t.space.lg, flexWrap: 'wrap' as const },
  toggleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm },
  toggleTrack: { width: 36, height: 20, borderRadius: 10, justifyContent: 'center' as const, paddingHorizontal: 2 },
  toggleThumb: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff' },
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

  // Add product form
  imageRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.md },
  thumbnailImage: { width: 72, height: 72, borderRadius: t.radius.md },
  sizeGrid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
  sizeButton: { paddingVertical: t.space.xs, paddingHorizontal: t.space.md, borderRadius: t.radius.md, borderWidth: 1 },
  sizeButtonText: { textTransform: 'uppercase' as const },

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

function AddProductForm({ onAdded, onCancel }: { onAdded: (p: Product) => void; onCancel: () => void }) {
  const t = useTheme();
  const s = makeStyles(t);
  const [title, setTitle]         = useState('');
  const [price, setPrice]         = useState('');
  const [imageUrl, setImageUrl]   = useState('');
  const [sizes, setSizes]         = useState<string[]>([]);
  const [postable, setPostable]   = useState(true);
  const [busy, setBusy]           = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const toggleSize = (sz: string) => setSizes(prev => prev.includes(sz) ? prev.filter(x => x !== sz) : [...prev, sz]);

  const pickImage = async () => {
    if (Platform.OS !== 'web') return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      setUploading(true);
      try { const { url } = await uploadProductImage(getAccessToken()!, file); setImageUrl(url); }
      catch (e) { setErr(e instanceof Error ? e.message : 'Upload failed'); }
      finally { setUploading(false); }
    };
    input.click();
  };

  const submit = async () => {
    if (!title.trim()) { setErr('Title is required'); return; }
    const priceCents = Math.round(parseFloat(price) * 100);
    if (isNaN(priceCents) || priceCents < 0) { setErr('Enter a valid price'); return; }
    setBusy(true); setErr(null);
    try {
      const stockLevel: Record<string, number> = {};
      sizes.forEach(sz => { stockLevel[sz] = 0; });
      const { product } = await createProduct(getAccessToken()!, {
        title: title.trim(), description: '', desc_points: [], price_cents: priceCents,
        image_url: imageUrl || null, images: imageUrl ? [imageUrl] : [],
        sizes, stock_level: stockLevel, postable, is_new: false,
        model_size: false, model_details: [], active: true,
      });
      onAdded(product);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create product');
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <Text variant="heading">New product</Text>

      <View style={s.fieldGroup}>
        <Text variant="label" muted>TITLE</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="e.g. T-shirt"
          placeholderTextColor={t.color.textMuted}
          style={s.textInput} />
      </View>

      <View style={s.fieldGroup}>
        <Text variant="label" muted>PRICE ($)</Text>
        <TextInput value={price} onChangeText={setPrice} placeholder="0.00" keyboardType="decimal-pad"
          placeholderTextColor={t.color.textMuted}
          style={s.textInput} />
      </View>

      <View style={s.fieldGroup}>
        <Text variant="label" muted>IMAGE</Text>
        {imageUrl ? (
          <View style={s.imageRow}>
            <Image source={{ uri: imageUrl }} style={s.thumbnailImage} resizeMode="cover" />
            <Button label="Change" variant="ghost" onPress={pickImage} />
          </View>
        ) : (
          <Button label={uploading ? 'Uploading…' : 'Upload image'} variant="secondary" onPress={pickImage} disabled={uploading} />
        )}
      </View>

      <View style={s.fieldGroup}>
        <Text variant="label" muted>SIZES</Text>
        <View style={s.sizeGrid}>
          {COMMON_SIZES.map(sz => (
            <Pressable key={sz} onPress={() => toggleSize(sz)} style={[
              s.sizeButton,
              {
                borderColor: sizes.includes(sz) ? t.color.primary : t.color.border,
                backgroundColor: sizes.includes(sz) ? t.color.primary : 'transparent',
              }
            ]}>
              <Text variant="small" color={sizes.includes(sz) ? t.color.primaryText : t.color.text} style={s.sizeButtonText}>{sz}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Pressable onPress={() => setPostable(p => !p)} style={s.toggleRow}>
        <View style={[s.toggleTrack, { backgroundColor: postable ? t.color.primary : t.color.border }]}>
          <View style={[s.toggleThumb, { alignSelf: postable ? 'flex-end' : 'flex-start' }]} />
        </View>
        <Text variant="small">Postable</Text>
      </Pressable>

      {err && <Notice message={err} tone="error" />}

      <View style={s.buttonRow}>
        <Button label="Add product" onPress={submit} loading={busy} style={s.flex1} />
        <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={busy} />
      </View>
    </Card>
  );
}

// ── Store screen ──────────────────────────────────────────────────────────────
const COLS = 2;

export default function Commerce() {
  const t = useTheme();
  const s = makeStyles(t);
  const { features } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState<string | null>(null);
  const [adding, setAdding]     = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setProducts((await listAdminProducts(getAccessToken()!)).products); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load products'); }
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
    <Screen toast={err ? { text: err, tone: 'error' } : null} onDismissToast={() => setErr(null)}>
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

      {adding && <AddProductForm onAdded={handleAdded} onCancel={() => setAdding(false)} />}

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
                  onSaved={handleSaved}
                  onClose={() => setSelectedId(null)}
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
