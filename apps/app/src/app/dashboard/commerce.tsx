import { useEffect, useState, useCallback } from 'react';
import { View, Pressable, Image } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Product } from '@blnk/shared';
import { useAuth } from '@/lib/auth-context';
import { getAccessToken } from '@/lib/session';
import { listAdminProducts, updateProduct } from '@/lib/api';
import { Screen, Text, Button } from '@/ui/components';
import { useTheme } from '@/theme';

function fmt(cents: number) { return (cents / 100).toFixed(2); }
function primaryImage(p: Product): string | null { return p.media?.primary_image ?? null; }

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
  screenHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  titleSection: { gap: 2 },
  headerButtons: { flexDirection: 'row' as const, gap: t.space.sm },
  productsContainer: { gap: t.space.md },
  productRow: { flexDirection: 'row' as const, gap: t.space.md },
  spacer: { flex: 1 },
});

// ── Store screen ──────────────────────────────────────────────────────────────
const COLS = 2;

export default function Commerce() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { features } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

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
          <Button label="Add product" onPress={() => router.push('/dashboard/commerce/new' as never)} />
        </View>
      </View>

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
