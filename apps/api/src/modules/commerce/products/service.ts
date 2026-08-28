import {
  listProducts, getProduct, createProduct, updateProduct,
  listVariants, getVariant, createVariant, updateVariant, deleteVariant,
} from '../../../db/queries/commerce'
import type { Product, ProductVariant, ProductStockStatus } from '@blnk/shared'
import { Errors } from '../../../utils/errors'
import { config } from '../../../config'

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function deriveStockStatus(qty: number, threshold: number | null): ProductStockStatus {
  if (qty <= 0) return 'out_of_stock'
  if (threshold && qty <= threshold) return 'low_stock' as ProductStockStatus
  return 'in_stock'
}

function deriveOnCreate(p: Omit<Product, 'id' | 'created_at' | 'updated_at'>): typeof p {
  const slug = p.slug || slugify(p.title)
  const brand = p.specifications?.brand ?? ''
  const shopUrl = config.shopUrl

  return {
    ...p,
    slug,
    handle:      p.handle || slug,
    stock_status: deriveStockStatus(p.stock_quantity, p.low_stock_threshold ?? null),
    has_variants: !!(p.variant_options?.option_names?.length),
    // is_digital forces no shipping
    shipping_info: p.is_digital
      ? { ...p.shipping_info, requires_shipping: false }
      : p.shipping_info,
    // published_at set on first active status
    published_at: p.status === 'active' ? (p.published_at ?? new Date().toISOString()) : p.published_at,
    seo: {
      ...p.seo,
      meta_title:       p.seo?.meta_title       || (brand ? `${p.title} | ${brand}` : p.title),
      meta_description: p.seo?.meta_description || (p.content?.short_description?.slice(0, 160) ?? null),
      canonical_url:    p.seo?.canonical_url    || (shopUrl ? `${shopUrl}/products/${slug}` : null),
    },
  }
}

function deriveOnUpdate(
  patch: Partial<Omit<Product, 'id' | 'created_at'>>,
  existing: Product,
): typeof patch {
  const out = { ...patch }

  // stock_status always recomputed when stock_quantity or threshold changes
  if ('stock_quantity' in out || 'low_stock_threshold' in out) {
    const qty       = out.stock_quantity       ?? existing.stock_quantity
    const threshold = out.low_stock_threshold  ?? existing.low_stock_threshold ?? null
    out.stock_status = deriveStockStatus(qty, threshold)
  }

  // slug/handle from title if title changes and slug wasn't explicitly set
  if ('title' in out && out.title && !out.slug) {
    out.slug   = slugify(out.title)
    out.handle = out.handle ?? out.slug
  }

  // published_at: set only on first transition to active
  if (out.status === 'active' && !existing.published_at) {
    out.published_at = new Date().toISOString()
  }

  // is_digital forces no shipping
  if (out.is_digital === true) {
    out.shipping_info = { ...existing.shipping_info, ...out.shipping_info, requires_shipping: false }
  }

  // has_variants from variant_options
  if (out.variant_options) {
    out.has_variants = !!(out.variant_options.option_names?.length)
  }

  // SEO fallbacks — only fill in if the field is being cleared or was never set
  const existingSeo = existing.seo ?? {}
  const patchSeo    = out.seo ?? {}
  const title       = out.title ?? existing.title
  const brand       = out.specifications?.brand ?? existing.specifications?.brand ?? ''
  const shopUrl     = config.shopUrl
  const slug        = out.slug ?? existing.slug ?? ''
  const shortDesc   = out.content?.short_description ?? existing.content?.short_description

  if (!patchSeo.meta_title && !existingSeo.meta_title) {
    out.seo = { ...patchSeo, meta_title: brand ? `${title} | ${brand}` : title }
  }
  if (!patchSeo.meta_description && !existingSeo.meta_description && shortDesc) {
    out.seo = { ...(out.seo ?? patchSeo), meta_description: shortDesc.slice(0, 160) }
  }
  if (!patchSeo.canonical_url && !existingSeo.canonical_url && shopUrl && slug) {
    out.seo = { ...(out.seo ?? patchSeo), canonical_url: `${shopUrl}/products/${slug}` }
  }

  return out
}

export async function fetchProducts(activeOnly = true): Promise<Product[]> {
  return listProducts(activeOnly)
}

export async function fetchProduct(id: string): Promise<Product> {
  const product = await getProduct(id)
  if (!product) throw Errors.notFound('product not found')
  return product
}

export async function addProduct(body: Omit<Product, 'id' | 'created_at' | 'updated_at'>): Promise<Product> {
  return createProduct(deriveOnCreate(body))
}

export async function editProduct(id: string, body: Partial<Omit<Product, 'id' | 'created_at'>>): Promise<Product> {
  const existing = await getProduct(id)
  if (!existing) throw Errors.notFound('product not found')
  const product = await updateProduct(id, deriveOnUpdate(body, existing))
  return product!
}

export async function fetchVariants(productId: string): Promise<ProductVariant[]> {
  return listVariants(productId)
}

export async function addVariant(productId: string, body: Omit<ProductVariant, 'id' | 'product_id' | 'created_at' | 'updated_at'>): Promise<ProductVariant> {
  return createVariant({ ...body, product_id: productId })
}

export async function editVariant(productId: string, variantId: string, body: Partial<Omit<ProductVariant, 'id' | 'product_id' | 'created_at'>>): Promise<ProductVariant> {
  const v = await getVariant(variantId)
  if (!v || v.product_id !== productId) throw Errors.notFound('variant not found')
  const updated = await updateVariant(variantId, body)
  return updated!
}

export async function removeVariant(productId: string, variantId: string): Promise<void> {
  const v = await getVariant(variantId)
  if (!v || v.product_id !== productId) throw Errors.notFound('variant not found')
  await deleteVariant(variantId)
}
