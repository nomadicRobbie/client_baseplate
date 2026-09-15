import { useState } from 'react';
import { View, Pressable, Image, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ProductType } from '@blnk/shared';
import { getAccessToken } from '@/lib/session';
import { createProduct, uploadProductImage } from '@/lib/api';
import { useImageSlots, type UploadFn } from '@/lib/image-slots';
import { useProfile } from '@/lib/profile-context';
import { Screen, Text, Button, Pill, TextField } from '@/ui/components';
import { useTheme } from '@/theme';

const tok = () => getAccessToken()!;
const toCents = (s: string) => { const n = parseFloat(s); return isNaN(n) ? null : Math.round(n * 100); };
const toNum = (s: string) => { const n = parseInt(s, 10); return isNaN(n) ? null : n; };
const toArr = (s: string): string[] => s.split(',').map(x => x.trim()).filter(Boolean);
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const truncate = (s: string, n: number) => s.length <= n ? s : s.slice(0, n - 1) + '…';

const autoSku = (title: string): string => {
  const slug = title.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 10);
  return `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
};

const SEO_TYPE: Record<ProductType, string> = {
  physical: 'Product',
  digital: 'SoftwareApplication',
  service: 'Service',
};

const STEPS = ['The product', 'Details', 'Price & Photos', 'Review'] as const;
const TOTAL = STEPS.length;

function PillSelect<T extends string>({ options, value, onChange }: {
  options: T[]; value: T; onChange: (v: T) => void;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  return (
    <View style={s.pillRow}>
      {options.map(o => <Pill key={o} label={o} active={value === o} onPress={() => onChange(o)} />)}
    </View>
  );
}

function ImageRow({ slots, onAdd, onRetry }: {
  slots: ReturnType<typeof useImageSlots>['slots'];
  onAdd: () => void;
  onRetry: (id: string) => void;
}) {
  const t = useTheme();
  const s = makeStyles(t);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.imageScroll}>
      <View style={s.imageRow}>
        {slots.map(slot => (
          <Pressable key={slot.id} onPress={slot.status === 'error' ? () => onRetry(slot.id) : undefined}
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
          </Pressable>
        ))}
        <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel="Add image" style={s.imageAdd}>
          <Ionicons name="add" size={28} color={t.color.textMuted} />
        </Pressable>
      </View>
    </ScrollView>
  );
}

export default function NewProduct() {
  const t = useTheme();
  const s = makeStyles(t);
  const router = useRouter();
  const { data: profile } = useProfile();
  const currency = profile?.org?.currency ?? process.env.EXPO_PUBLIC_CURRENCY ?? 'NZD';

  const [step, setStep]     = useState(0);
  const [saving, setSaving] = useState(false);
  const [toast, setToast]   = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  // Step 0 — The product
  const [title, setTitle]         = useState('');
  const [subtitle, setSubtitle]   = useState('');
  const [shortDesc, setShortDesc] = useState('');
  const [description, setDesc]    = useState('');

  // Step 1 — Details
  const [type, setType]             = useState<ProductType>('physical');
  const [brand, setBrand]           = useState('');
  const [category, setCategory]     = useState('');
  const [tagsRaw, setTags]          = useState('');
  const [featuresRaw, setFeatures]  = useState('');
  const [colour, setColour]         = useState('');
  const [material, setMaterial]     = useState('');

  // Step 2 — Price & Photos
  const [price, setPrice]           = useState('');
  const [comparePrice, setCompare]  = useState('');
  const [costPrice, setCostPrice]   = useState('');
  const [stock, setStock]           = useState('0');
  const uploadFn: UploadFn = (f) => uploadProductImage(tok(), f);
  const { slots, pick, retrySlot, doneUrls, isUploading } = useImageSlots([], (msg) => setToast({ text: msg, tone: 'error' }));

  const canNext = (() => {
    if (step === 0) return title.trim().length > 0;
    if (step === 2) return price.trim().length > 0 && toCents(price) !== null;
    return true;
  })();

  const next = () => { if (step < TOTAL - 1) setStep(s => s + 1); };
  const back = () => { if (step > 0) setStep(s => s - 1); };

  const create = async () => {
    const priceCents = toCents(price);
    if (!priceCents && priceCents !== 0) { setToast({ text: 'Enter a valid price', tone: 'error' }); return; }
    setSaving(true);

    const t_title = title.trim();
    const t_desc  = description.trim();
    const t_short = shortDesc.trim();
    const t_brand = brand.trim();
    const stockQty = toNum(stock) ?? 0;
    const primaryImage = doneUrls[0] ?? null;
    const seoDesc = t_short || (t_desc ? truncate(t_desc, 160) : null);

    try {
      const { product } = await createProduct(tok(), {
        // core
        title: t_title,
        description: t_desc,
        price_cents: priceCents,
        compare_at_price_cents: toCents(comparePrice),
        cost_price_cents: toCents(costPrice),
        currency,
        status: 'draft',
        product_type: type,
        active: false,
        featured: false,
        is_digital: type === 'digital',
        visibility: 'public',
        tax_class: null,
        tax_inclusive: true,
        // identity — auto-derived from title
        sku: autoSku(t_title),
        slug: slugify(t_title),
        handle: slugify(t_title),
        parent_id: null, gtin: null, mpn: null,
        // inventory — derived from stock input
        stock_quantity: stockQty,
        stock_status: stockQty > 0 ? 'in_stock' : 'out_of_stock',
        track_inventory: true,
        allow_backorder: false,
        low_stock_threshold: null,
        warehouse_location: null,
        lead_time_days: null,
        restock_date: null,
        // variants
        has_variants: false,
        variant_options: {},
        rating_average: null,
        rating_count: 0,
        // channels — default to web
        sales_channels: ['web'],
        available_regions: [],
        published_at: null,
        // content — from wizard inputs
        content: {
          subtitle: subtitle.trim() || null,
          short_description: t_short || null,
          description_html: t_desc ? `<p>${t_desc}</p>` : null,
          features: toArr(featuresRaw),
        },
        // media — images + auto alt text from title
        media: {
          primary_image: primaryImage,
          gallery: doneUrls,
          alt_text: t_title,
        },
        // specifications — from brand/colour/material
        specifications: {
          brand: t_brand || null,
          manufacturer: t_brand || null,
          colour: colour.trim() || null,
          material: material.trim() || null,
        },
        // shipping — requires_shipping derived from type
        shipping_info: {
          requires_shipping: type === 'physical',
          free_shipping: false,
          hazardous: false,
        },
        // organisation — category + tags from wizard
        organisation: {
          category: category.trim() || null,
          tags: toArr(tagsRaw),
        },
        // SEO — fully derived, no extra input needed
        seo: {
          meta_title: t_title,
          meta_description: seoDesc,
          og_image: primaryImage,
          keywords: toArr(tagsRaw),
          structured_data_type: SEO_TYPE[type],
        },
        // compliance — safe defaults
        compliance: {
          returnable: true,
          age_restricted: false,
        },
        social_proof: {},
        pricing_meta: {},
        digital_product: {},
      });
      router.replace(`/dashboard/commerce/${product.id}` as never);
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : 'Failed to create product', tone: 'error' });
      setSaving(false);
    }
  };

  const fmtPrice = (v: string) => {
    const c = toCents(v);
    return c != null ? `${currency} ${(c / 100).toFixed(2)}` : '—';
  };

  return (
    <Screen toast={toast} onDismissToast={() => setToast(null)}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/dashboard/commerce' as never)} accessibilityRole="button" accessibilityLabel="Cancel"
          style={s.cancelBtn}>
          <Ionicons name="chevron-back" size={20} color={t.color.primary} />
          <Text variant="label" color={t.color.primary}>Cancel</Text>
        </Pressable>
        <Text variant="heading">New product</Text>
        <Text variant="small" muted>Step {step + 1} of {TOTAL}</Text>
      </View>

      {/* Progress bar */}
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${((step + 1) / TOTAL) * 100}%` as never }]} />
      </View>

      {/* Step label */}
      <Text style={s.stepTitle}>{STEPS[step]}</Text>

      {/* ── Step 0: The product ── */}
      {step === 0 && (
        <View style={s.fields}>
          <TextField label="Title *" value={title} onChangeText={setTitle} placeholder="Give your product a name" />
          <TextField label="Subtitle" value={subtitle} onChangeText={setSubtitle} placeholder="A short tagline" />
          <TextField label="Short description" value={shortDesc} onChangeText={setShortDesc} multiline placeholder="One or two sentences shown in listings" />
          <TextField label="Full description" value={description} onChangeText={setDesc} multiline placeholder="The full product story" />
        </View>
      )}

      {/* ── Step 1: Details ── */}
      {step === 1 && (
        <View style={s.fields}>
          <View style={s.fieldBlock}>
            <Text variant="label" muted>Type</Text>
            <PillSelect<ProductType> options={['physical', 'digital', 'service']} value={type} onChange={setType} />
          </View>
          <TextField label="Brand" value={brand} onChangeText={setBrand} placeholder="e.g. Acme Co." />
          <TextField label="Category" value={category} onChangeText={setCategory} placeholder="e.g. Apparel, Electronics" />
          <TextField label="Tags" value={tagsRaw} onChangeText={setTags} placeholder="e.g. summer, sale, new-arrival" />
          <TextField label="Features" value={featuresRaw} onChangeText={setFeatures} placeholder="e.g. Waterproof, Lightweight, 2-year warranty" multiline />
          {type === 'physical' && (
            <>
              <TextField label="Colour" value={colour} onChangeText={setColour} placeholder="e.g. Midnight Black" />
              <TextField label="Material" value={material} onChangeText={setMaterial} placeholder="e.g. 100% Cotton" />
            </>
          )}
          <Text variant="small" muted>Separate tags and features with commas.</Text>
        </View>
      )}

      {/* ── Step 2: Price & Photos ── */}
      {step === 2 && (
        <View style={s.fields}>
          <TextField label={`Price (${currency}) *`} value={price} onChangeText={setPrice} placeholder="0.00" keyboardType="default" />
          <TextField label={`Compare-at price (${currency})`} value={comparePrice} onChangeText={setCompare} placeholder="Leave blank if not on sale" keyboardType="default" />
          <TextField label={`Cost price (${currency})`} value={costPrice} onChangeText={setCostPrice} placeholder="What you paid for it" keyboardType="default" />
          <TextField label="Stock quantity" value={stock} onChangeText={setStock} keyboardType="number-pad" />
          <View style={s.fieldBlock}>
            <Text variant="label" muted>Photos</Text>
            <ImageRow
              slots={slots}
              onAdd={() => void pick(uploadFn, (msg) => setToast({ text: msg, tone: 'error' }))}
              onRetry={(id) => retrySlot(id, uploadFn)}
            />
            <Text variant="small" muted>First photo becomes the cover image. You can add more later.</Text>
          </View>
        </View>
      )}

      {/* ── Step 3: Review ── */}
      {step === 3 && (
        <View style={s.fields}>
          <View style={s.reviewCard}>
            {doneUrls[0] ? (
              <Image source={{ uri: doneUrls[0] }} style={s.reviewImage} resizeMode="cover" />
            ) : (
              <View style={[s.reviewImage, s.reviewImageEmpty]}>
                <Ionicons name="image-outline" size={40} color={t.color.textMuted} />
              </View>
            )}
            <View style={s.reviewBody}>
              <Text variant="heading">{title}</Text>
              {subtitle ? <Text muted>{subtitle}</Text> : null}
              {shortDesc ? <Text variant="small" muted>{shortDesc}</Text> : null}
              <View style={s.reviewRow}>
                <Text variant="label">{fmtPrice(price)}</Text>
                {comparePrice ? <Text variant="small" muted>was {fmtPrice(comparePrice)}</Text> : null}
                <Pill label={type} active={false} onPress={() => {}} />
              </View>
              {(brand || category || colour || material) ? (
                <View style={s.reviewRow}>
                  {brand ? <Text variant="small" muted>{brand}</Text> : null}
                  {category ? <Text variant="small" muted>· {category}</Text> : null}
                  {colour ? <Text variant="small" muted>· {colour}</Text> : null}
                  {material ? <Text variant="small" muted>· {material}</Text> : null}
                </View>
              ) : null}
              {toArr(featuresRaw).length > 0 && (
                <View style={s.reviewFeatures}>
                  {toArr(featuresRaw).map(f => (
                    <Text key={f} variant="small" muted>· {f}</Text>
                  ))}
                </View>
              )}
            </View>
          </View>
          <Text variant="small" muted>
            A few more details like shipping, variants, and returns can be added once the product is live — your SEO, stock status, and store listing are all set up from what you've entered.
          </Text>
        </View>
      )}

      {/* Nav */}
      <View style={s.nav}>
        {step > 0 ? (
          <Button label="Back" variant="ghost" onPress={back} style={s.navBack} />
        ) : (
          <View style={s.navBack} />
        )}
        {step < TOTAL - 1 ? (
          <Button label="Next" onPress={next} disabled={!canNext} style={s.navNext} />
        ) : (
          <Button
            label={saving ? 'Creating…' : isUploading ? 'Uploading…' : 'Create product'}
            onPress={create}
            loading={saving}
            disabled={isUploading}
            style={s.navNext}
          />
        )}
      </View>
    </Screen>
  );
}

const makeStyles = (t: ReturnType<typeof useTheme>) => ({
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  cancelBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  stepTitle: { fontSize: t.size.xxl, fontWeight: '700' as const, fontFamily: t.font.mono, letterSpacing: -0.5, color: t.color.text },
  progressTrack: { height: 4, backgroundColor: t.color.surfaceAlt, borderRadius: 2, overflow: 'hidden' as const },
  progressFill: { height: 4, backgroundColor: t.color.primary, borderRadius: 2 },
  fields: { gap: t.space.lg },
  fieldBlock: { gap: t.space.sm },
  pillRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: t.space.sm },
  imageScroll: { height: 88 },
  imageRow: { flexDirection: 'row' as const, gap: t.space.sm, alignItems: 'center' as const },
  imageSlot: { width: 80, height: 80, borderRadius: t.radius.md, overflow: 'hidden' as const },
  imageThumb: { width: 80, height: 80 },
  imageOverlay: { position: 'absolute' as const, inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center' as const, justifyContent: 'center' as const },
  imageOverlayError: { backgroundColor: 'rgba(220,38,38,0.6)' },
  imageAdd: { width: 80, height: 80, borderRadius: t.radius.md, backgroundColor: t.color.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  nav: { flexDirection: 'row' as const, gap: t.space.md, marginTop: t.space.lg },
  navBack: { flex: 1 },
  navNext: { flex: 2 },
  reviewCard: { borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.color.border, overflow: 'hidden' as const, backgroundColor: t.color.surface },
  reviewImage: { width: '100%' as const, aspectRatio: 16 / 9 },
  reviewImageEmpty: { backgroundColor: t.color.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  reviewBody: { padding: t.space.lg, gap: t.space.sm },
  reviewRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.space.sm, flexWrap: 'wrap' as const },
  reviewFeatures: { gap: 2 },
});
