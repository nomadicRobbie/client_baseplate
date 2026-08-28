import { query } from '../pool'
import type { Product, ProductVariant, Order, OrderPaymentStatus, FulfillmentStatus, Enquiry } from '@blnk/shared'

// ── Products ──────────────────────────────────────────────────────────────────

export async function listProducts(activeOnly = true): Promise<Product[]> {
  return activeOnly
    ? query<Product>('SELECT * FROM commerce_products WHERE active = TRUE ORDER BY created_at DESC')
    : query<Product>('SELECT * FROM commerce_products ORDER BY created_at DESC')
}

export async function getProduct(id: string): Promise<Product | null> {
  const rows = await query<Product>('SELECT * FROM commerce_products WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const rows = await query<Product>('SELECT * FROM commerce_products WHERE slug = $1 AND active = TRUE', [slug])
  return rows[0] ?? null
}

type ProductInput = Omit<Product, 'id' | 'created_at' | 'updated_at'>

export async function createProduct(p: ProductInput): Promise<Product> {
  const rows = await query<Product>(
    `INSERT INTO commerce_products (
       title, description, sku, slug, handle, parent_id, gtin, mpn,
       status, visibility, product_type, featured, is_digital,
       price_cents, compare_at_price_cents, cost_price_cents, currency,
       tax_class, tax_inclusive, pricing_meta,
       stock_quantity, stock_status, track_inventory, allow_backorder,
       low_stock_threshold, warehouse_location, lead_time_days, restock_date,
       has_variants, variant_options,
       rating_average, rating_count, sales_channels, available_regions,
       content, media, specifications, shipping_info, organisation,
       seo, social_proof, digital_product, compliance,
       active, published_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,
       $9,$10,$11,$12,$13,
       $14,$15,$16,$17,
       $18,$19,$20,
       $21,$22,$23,$24,
       $25,$26,$27,$28,
       $29,$30,
       $31,$32,$33,$34,
       $35,$36,$37,$38,$39,
       $40,$41,$42,$43,
       $44,$45
     ) RETURNING *`,
    [
      p.title, p.description, p.sku, p.slug, p.handle, p.parent_id, p.gtin, p.mpn,
      p.status, p.visibility, p.product_type, p.featured, p.is_digital,
      p.price_cents, p.compare_at_price_cents, p.cost_price_cents, p.currency,
      p.tax_class, p.tax_inclusive, JSON.stringify(p.pricing_meta ?? {}),
      p.stock_quantity, p.stock_status, p.track_inventory, p.allow_backorder,
      p.low_stock_threshold, p.warehouse_location, p.lead_time_days, p.restock_date,
      p.has_variants, JSON.stringify(p.variant_options ?? {}),
      p.rating_average, p.rating_count, p.sales_channels, p.available_regions,
      JSON.stringify(p.content ?? {}), JSON.stringify(p.media ?? {}),
      JSON.stringify(p.specifications ?? {}), JSON.stringify(p.shipping_info ?? {}),
      JSON.stringify(p.organisation ?? {}), JSON.stringify(p.seo ?? {}),
      JSON.stringify(p.social_proof ?? {}), JSON.stringify(p.digital_product ?? {}),
      JSON.stringify(p.compliance ?? {}),
      p.active, p.published_at,
    ],
  )
  return rows[0]!
}

const PRODUCT_SCALAR_FIELDS = [
  'title','description','sku','slug','handle','parent_id','gtin','mpn',
  'status','visibility','product_type','featured','is_digital',
  'price_cents','compare_at_price_cents','cost_price_cents','currency',
  'tax_class','tax_inclusive',
  'stock_quantity','stock_status','track_inventory','allow_backorder',
  'low_stock_threshold','warehouse_location','lead_time_days','restock_date',
  'has_variants','rating_average','rating_count','sales_channels','available_regions',
  'active','published_at',
] as const

const PRODUCT_JSON_FIELDS = [
  'content','media','specifications','shipping_info','organisation',
  'seo','social_proof','pricing_meta','digital_product','compliance','variant_options',
] as const

export async function updateProduct(id: string, p: Partial<Omit<Product, 'id' | 'created_at'>>): Promise<Product | null> {
  const fields: string[] = []
  const values: unknown[] = []
  let i = 1

  for (const key of PRODUCT_SCALAR_FIELDS) {
    if (key in p) { fields.push(`${key} = $${i++}`); values.push(p[key as keyof typeof p]) }
  }
  for (const key of PRODUCT_JSON_FIELDS) {
    if (key in p) { fields.push(`${key} = $${i++}`); values.push(JSON.stringify(p[key as keyof typeof p])) }
  }
  if (!fields.length) return getProduct(id)

  fields.push(`updated_at = NOW()`)
  values.push(id)

  const rows = await query<Product>(
    `UPDATE commerce_products SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  )
  return rows[0] ?? null
}

export async function decrementStock(variantId: string, qty: number): Promise<void> {
  await query(
    `UPDATE commerce_product_variants
     SET stock_quantity = GREATEST(0, stock_quantity - $1),
         stock_status = CASE WHEN GREATEST(0, stock_quantity - $1) = 0 THEN 'out_of_stock' ELSE stock_status END,
         updated_at = NOW()
     WHERE id = $2`,
    [qty, variantId],
  )
}

// ── Variants ──────────────────────────────────────────────────────────────────

export async function listVariants(productId: string): Promise<ProductVariant[]> {
  return query<ProductVariant>(
    'SELECT * FROM commerce_product_variants WHERE product_id = $1 ORDER BY is_default DESC, created_at ASC',
    [productId],
  )
}

export async function getVariant(id: string): Promise<ProductVariant | null> {
  const rows = await query<ProductVariant>('SELECT * FROM commerce_product_variants WHERE id = $1', [id])
  return rows[0] ?? null
}

type VariantInput = Omit<ProductVariant, 'id' | 'created_at' | 'updated_at'>

export async function createVariant(v: VariantInput): Promise<ProductVariant> {
  const rows = await query<ProductVariant>(
    `INSERT INTO commerce_product_variants (
       product_id, sku, title, option_values,
       price_cents, compare_at_price_cents, cost_price_cents,
       stock_quantity, stock_status, track_inventory, allow_backorder,
       low_stock_threshold, warehouse_location, image_id, weight_grams,
       is_default, active
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      v.product_id, v.sku, v.title, JSON.stringify(v.option_values),
      v.price_cents, v.compare_at_price_cents, v.cost_price_cents,
      v.stock_quantity, v.stock_status, v.track_inventory, v.allow_backorder,
      v.low_stock_threshold, v.warehouse_location, v.image_id, v.weight_grams,
      v.is_default, v.active,
    ],
  )
  return rows[0]!
}

const VARIANT_FIELDS = [
  'sku','title','option_values','price_cents','compare_at_price_cents','cost_price_cents',
  'stock_quantity','stock_status','track_inventory','allow_backorder',
  'low_stock_threshold','warehouse_location','image_id','weight_grams','is_default','active',
] as const

export async function updateVariant(id: string, v: Partial<Omit<ProductVariant, 'id' | 'product_id' | 'created_at'>>): Promise<ProductVariant | null> {
  const fields: string[] = []
  const values: unknown[] = []
  let i = 1

  for (const key of VARIANT_FIELDS) {
    if (!(key in v)) continue
    const val = key === 'option_values' ? JSON.stringify(v[key]) : v[key as keyof typeof v]
    fields.push(`${key} = $${i++}`)
    values.push(val)
  }
  if (!fields.length) return getVariant(id)

  fields.push(`updated_at = NOW()`)
  values.push(id)

  const rows = await query<ProductVariant>(
    `UPDATE commerce_product_variants SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  )
  return rows[0] ?? null
}

export async function deleteVariant(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    'DELETE FROM commerce_product_variants WHERE id = $1 RETURNING id',
    [id],
  )
  return rows.length > 0
}

// ── Orders ────────────────────────────────────────────────────────────────────

export async function createOrder(o: Omit<Order, 'id' | 'created_at' | 'updated_at'>): Promise<Order> {
  const rows = await query<Order>(
    `INSERT INTO commerce_orders
       (order_ref, email, name, phone, shipping_address, items, total_cents,
        payment_intent_id, payment_status, fulfillment_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [o.order_ref, o.email, o.name, o.phone, o.shipping_address, JSON.stringify(o.items),
     o.total_cents, o.payment_intent_id, o.payment_status, o.fulfillment_status],
  )
  return rows[0]!
}

export async function getOrderByRef(ref: string): Promise<Order | null> {
  const rows = await query<Order>('SELECT * FROM commerce_orders WHERE order_ref = $1', [ref])
  return rows[0] ?? null
}

export async function getOrderByPaymentIntent(intentId: string): Promise<Order | null> {
  const rows = await query<Order>('SELECT * FROM commerce_orders WHERE payment_intent_id = $1', [intentId])
  return rows[0] ?? null
}

export async function listOrders(fulfillmentStatus?: FulfillmentStatus): Promise<Order[]> {
  if (fulfillmentStatus) {
    return query<Order>(
      'SELECT * FROM commerce_orders WHERE fulfillment_status = $1 ORDER BY created_at DESC',
      [fulfillmentStatus],
    )
  }
  return query<Order>('SELECT * FROM commerce_orders ORDER BY created_at DESC')
}

export async function updateOrderPaymentStatus(
  intentId: string,
  status: OrderPaymentStatus,
): Promise<void> {
  await query(
    `UPDATE commerce_orders SET payment_status = $1, updated_at = NOW() WHERE payment_intent_id = $2`,
    [status, intentId],
  )
}

export async function packOrder(id: string, userId: string): Promise<Order | null> {
  const rows = await query<Order>(
    `UPDATE commerce_orders
     SET fulfillment_status = 'packed', packed_at = NOW(), packed_by = $1, updated_at = NOW()
     WHERE id = $2 AND fulfillment_status = 'pending'
     RETURNING *`,
    [userId, id],
  )
  return rows[0] ?? null
}

export async function fulfillOrder(id: string, userId: string): Promise<Order | null> {
  const rows = await query<Order>(
    `UPDATE commerce_orders
     SET fulfillment_status = 'fulfilled', fulfilled_at = NOW(), fulfilled_by = $1, updated_at = NOW()
     WHERE id = $2 AND fulfillment_status = 'packed'
     RETURNING *`,
    [userId, id],
  )
  return rows[0] ?? null
}

// ── Enquiries ─────────────────────────────────────────────────────────────────

export async function createEnquiry(e: Omit<Enquiry, 'id' | 'created_at'>): Promise<Enquiry> {
  const rows = await query<Enquiry>(
    `INSERT INTO commerce_enquiries (enquiry_ref, name, email, subject, message)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [e.enquiry_ref, e.name, e.email, e.subject, e.message],
  )
  return rows[0]!
}

export async function listEnquiries(): Promise<Enquiry[]> {
  return query<Enquiry>('SELECT * FROM commerce_enquiries ORDER BY created_at DESC')
}
