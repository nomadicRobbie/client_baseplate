import { query } from '../pool'
import type { Product, Order, OrderPaymentStatus, FulfillmentStatus, Enquiry } from '@blnk/shared'

// ── Products ──────────────────────────────────────────────────────────────────

export async function listProducts(activeOnly = true): Promise<Product[]> {
  const rows = activeOnly
    ? await query<Product>('SELECT * FROM commerce_products WHERE active = TRUE ORDER BY created_at DESC')
    : await query<Product>('SELECT * FROM commerce_products ORDER BY created_at DESC')
  return rows
}

export async function getProduct(id: string): Promise<Product | null> {
  const rows = await query<Product>('SELECT * FROM commerce_products WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function createProduct(p: Omit<Product, 'id' | 'created_at' | 'updated_at'>): Promise<Product> {
  const rows = await query<Product>(
    `INSERT INTO commerce_products
       (title, description, desc_points, price_cents, image_url, images,
        sizes, stock_level, postable, is_new, model_size, model_details, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [p.title, p.description, p.desc_points, p.price_cents, p.image_url,
     p.images, p.sizes, p.stock_level, p.postable, p.is_new,
     p.model_size, p.model_details, p.active],
  )
  return rows[0]!
}

export async function updateProduct(id: string, p: Partial<Omit<Product, 'id' | 'created_at'>>): Promise<Product | null> {
  const fields: string[] = []
  const values: unknown[] = []
  let i = 1

  const allowed = ['title','description','desc_points','price_cents','image_url','images',
    'sizes','stock_level','postable','is_new','model_size','model_details','active'] as const

  for (const key of allowed) {
    if (key in p) {
      fields.push(`${key} = $${i++}`)
      values.push(p[key as keyof typeof p])
    }
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

export async function decrementStock(
  id: string,
  size: string,
  qty: number,
): Promise<void> {
  await query(
    `UPDATE commerce_products
     SET stock_level = jsonb_set(
       stock_level,
       ARRAY[$1],
       (COALESCE((stock_level->$1)::int, 0) - $2)::text::jsonb
     ),
     updated_at = NOW()
     WHERE id = $3`,
    [size, qty, id],
  )
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
