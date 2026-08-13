import { useEffect, useState, useCallback } from 'react';
import { View, Pressable, Image, TextInput, Platform } from 'react-native';
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
    <View style={{ gap: t.space.xs }}>
      {sizes.map(size => (
        <View key={size} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="small" style={{ textTransform: 'uppercase', minWidth: 48 }}>{size}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
            <Pressable onPress={() => set(size, Math.max(0, get(size) - 1))} style={{ padding: t.space.sm }}>
              <Ionicons name="remove-circle-outline" size={20} color={t.color.textMuted} />
            </Pressable>
            <Text variant="label" style={{ minWidth: 28, textAlign: 'center' }}>{get(size)}</Text>
            <Pressable onPress={() => set(size, get(size) + 1)} style={{ padding: t.space.sm }}>
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
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="heading">{product.title}</Text>
        <Pressable onPress={onClose} style={{ padding: t.space.sm }}>
          <Ionicons name="close" size={20} color={t.color.textMuted} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
        {draft.image_url ? (
          <Image source={{ uri: draft.image_url }} style={{ width: 80, height: 80, borderRadius: t.radius.md }} resizeMode="cover" />
        ) : (
          <View style={{ width: 80, height: 80, borderRadius: t.radius.md, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="image-outline" size={28} color={t.color.textMuted} />
          </View>
        )}
        {Platform.OS === 'web' && (
          <Button label={uploading ? 'Uploading…' : 'Change image'} variant="secondary" onPress={pickImage} disabled={uploading} />
        )}
      </View>

      <View style={{ gap: t.space.xs }}>
        <Text variant="label" muted>TITLE</Text>
        <TextInput value={draft.title} onChangeText={v => setDraft(d => ({ ...d, title: v }))}
          style={{ backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14 }} />
      </View>

      <View style={{ gap: t.space.xs }}>
        <Text variant="label" muted>PRICE ($)</Text>
        <TextInput
          value={fmt(draft.price_cents)}
          onChangeText={v => { const n = parseFloat(v); if (!isNaN(n)) setDraft(d => ({ ...d, price_cents: Math.round(n * 100) })); }}
          keyboardType="decimal-pad"
          style={{ backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14 }} />
      </View>

      <View style={{ gap: t.space.xs }}>
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
            style={{ backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14, width: 100 }}
          />
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: t.space.lg, flexWrap: 'wrap' }}>
        {[{ key: 'is_new', label: 'New badge' }, { key: 'postable', label: 'Postable' }].map(({ key, label }) => (
          <Pressable key={key} onPress={() => setDraft(d => ({ ...d, [key]: !d[key as keyof Product] }))}
            style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
            <View style={{ width: 36, height: 20, borderRadius: 10, backgroundColor: draft[key as keyof Product] ? t.color.primary : t.color.border, justifyContent: 'center', paddingHorizontal: 2 }}>
              <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', alignSelf: draft[key as keyof Product] ? 'flex-end' : 'flex-start' }} />
            </View>
            <Text variant="small">{label}</Text>
          </Pressable>
        ))}
      </View>

      {msg && <Notice message={msg.text} tone={msg.tone} />}

      <View style={{ flexDirection: 'row', gap: t.space.md }}>
        <Button label="Save changes" onPress={save} loading={busy} disabled={!dirty} style={{ flex: 1 }} />
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

  const totalStock = typeof product.stock_level === 'object' && product.stock_level !== null
    ? Object.values(product.stock_level as Record<string, number>).reduce((a, b) => a + b, 0)
    : null;

  return (
    <View style={{ flex: 1 }}>
      <Pressable
        onPress={onSelect}
        style={({ pressed }) => ({
          backgroundColor: selected ? t.color.surfaceAlt : t.color.surface,
          borderRadius: t.radius.lg,
          borderWidth: 2,
          borderColor: selected ? t.color.primary : t.color.border,
          overflow: 'hidden',
          opacity: pressed ? 0.85 : 1,
        })}
      >
        {product.image_url ? (
          <Image source={{ uri: product.image_url }} style={{ width: '100%', aspectRatio: 1, backgroundColor: t.color.surfaceAlt }} resizeMode="cover" />
        ) : (
          <View style={{ width: '100%', aspectRatio: 1, backgroundColor: t.color.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="image-outline" size={36} color={t.color.textMuted} />
          </View>
        )}

        {/* Active dot overlay */}
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); onToggleActive(); }}
          style={{ position: 'absolute', top: t.space.sm, right: t.space.sm, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 99, padding: 6 }}
          accessibilityLabel={product.active ? 'Active — tap to deactivate' : 'Inactive — tap to activate'}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: product.active ? '#4ade80' : '#f87171' }} />
        </Pressable>

        <View style={{ padding: t.space.md, gap: 2 }}>
          <Text variant="label">{product.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="small" muted>${fmt(product.price_cents)}</Text>
            {totalStock !== null && <Text variant="small" muted>{totalStock} in stock</Text>}
          </View>
        </View>
      </Pressable>
    </View>
  );
}

// ── Add product form ──────────────────────────────────────────────────────────
const COMMON_SIZES = ['xs', 's', 'm', 'l', 'xl', 'xxl', 'one-size'];

function AddProductForm({ onAdded, onCancel }: { onAdded: (p: Product) => void; onCancel: () => void }) {
  const t = useTheme();
  const [title, setTitle]         = useState('');
  const [price, setPrice]         = useState('');
  const [imageUrl, setImageUrl]   = useState('');
  const [sizes, setSizes]         = useState<string[]>([]);
  const [postable, setPostable]   = useState(true);
  const [busy, setBusy]           = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const toggleSize = (s: string) => setSizes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

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
      sizes.forEach(s => { stockLevel[s] = 0; });
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

      <View style={{ gap: t.space.xs }}>
        <Text variant="label" muted>TITLE</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="e.g. T-shirt"
          placeholderTextColor={t.color.textMuted}
          style={{ backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14 }} />
      </View>

      <View style={{ gap: t.space.xs }}>
        <Text variant="label" muted>PRICE ($)</Text>
        <TextInput value={price} onChangeText={setPrice} placeholder="0.00" keyboardType="decimal-pad"
          placeholderTextColor={t.color.textMuted}
          style={{ backgroundColor: t.color.surfaceAlt, borderWidth: 1, borderColor: t.color.border, borderRadius: t.radius.md, padding: t.space.md, color: t.color.text, fontSize: 14 }} />
      </View>

      <View style={{ gap: t.space.xs }}>
        <Text variant="label" muted>IMAGE</Text>
        {imageUrl ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
            <Image source={{ uri: imageUrl }} style={{ width: 72, height: 72, borderRadius: t.radius.md }} resizeMode="cover" />
            <Button label="Change" variant="ghost" onPress={pickImage} />
          </View>
        ) : (
          <Button label={uploading ? 'Uploading…' : 'Upload image'} variant="secondary" onPress={pickImage} disabled={uploading} />
        )}
      </View>

      <View style={{ gap: t.space.xs }}>
        <Text variant="label" muted>SIZES</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm }}>
          {COMMON_SIZES.map(s => (
            <Pressable key={s} onPress={() => toggleSize(s)} style={{
              paddingVertical: t.space.xs, paddingHorizontal: t.space.md, borderRadius: t.radius.md, borderWidth: 1,
              borderColor: sizes.includes(s) ? t.color.primary : t.color.border,
              backgroundColor: sizes.includes(s) ? t.color.primary : 'transparent',
            }}>
              <Text variant="small" color={sizes.includes(s) ? t.color.primaryText : t.color.text} style={{ textTransform: 'uppercase' }}>{s}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Pressable onPress={() => setPostable(p => !p)} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
        <View style={{ width: 36, height: 20, borderRadius: 10, backgroundColor: postable ? t.color.primary : t.color.border, justifyContent: 'center', paddingHorizontal: 2 }}>
          <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', alignSelf: postable ? 'flex-end' : 'flex-start' }} />
        </View>
        <Text variant="small">Postable</Text>
      </Pressable>

      {err && <Notice message={err} tone="error" />}

      <View style={{ flexDirection: 'row', gap: t.space.md }}>
        <Button label="Add product" onPress={submit} loading={busy} style={{ flex: 1 }} />
        <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={busy} />
      </View>
    </Card>
  );
}

// ── Store screen ──────────────────────────────────────────────────────────────
const COLS = 2;

export default function Commerce() {
  const t = useTheme();
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
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ gap: 2 }}>
          <Text variant="title">Store</Text>
          {!loading && <Text muted>{active} active · {inactive} inactive</Text>}
        </View>
        <View style={{ flexDirection: 'row', gap: t.space.sm }}>
          <Button label="Refresh" variant="ghost" onPress={load} loading={loading} />
          {!adding && <Button label="Add product" onPress={() => { setAdding(true); setSelectedId(null); }} />}
        </View>
      </View>

      {adding && <AddProductForm onAdded={handleAdded} onCancel={() => setAdding(false)} />}
      {err && <Notice message={err} tone="error" />}

      {loading ? (
        <Text muted>Loading products…</Text>
      ) : products.length === 0 ? (
        <Text muted>No products yet. Add one above.</Text>
      ) : (
        <View style={{ gap: t.space.md }}>
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
              <View key={i} style={{ flexDirection: 'row', gap: t.space.md }}>
                {row.items.map(product => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    selected={product.id === selectedId}
                    onSelect={() => setSelectedId(id => id === product.id ? null : product.id)}
                    onToggleActive={() => handleToggleActive(product)}
                  />
                ))}
                {/* Pad last row if odd number of products */}
                {row.items.length < COLS && <View style={{ flex: 1 }} />}
              </View>
            )
          )}
        </View>
      )}
    </Screen>
  );
}
