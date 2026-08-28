import type { FastifyPluginAsync } from 'fastify'
import { verifyBlnkAuth, requireRole } from '../../../blnk/auth'
import { fetchProducts, fetchProduct, addProduct, editProduct, fetchVariants, addVariant, editVariant, removeVariant } from './service'
import type { Product, ProductVariant } from '@blnk/shared'

const productsPlugin: FastifyPluginAsync = async (fastify) => {
  // ── GET /commerce/products ────────────────────────────────────────────────
  fastify.get('/commerce/products', async (_req, reply) => {
    return reply.send({ products: await fetchProducts() })
  })

  // ── GET /commerce/products/:id ────────────────────────────────────────────
  fastify.get('/commerce/products/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    return reply.send({ product: await fetchProduct(id) })
  })

  // ── GET /commerce/products/:id/variants ──────────────────────────────────
  fastify.get('/commerce/products/:id/variants', async (req, reply) => {
    const { id } = req.params as { id: string }
    return reply.send({ variants: await fetchVariants(id) })
  })

  // ── GET /commerce/admin/products ─────────────────────────────────────────
  fastify.get('/commerce/admin/products', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (_req, reply) => {
    return reply.send({ products: await fetchProducts(false) })
  })

  // ── POST /commerce/admin/products ─────────────────────────────────────────
  fastify.post('/commerce/admin/products', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
    schema: {
      body: {
        type: 'object',
        required: ['title', 'price_cents'],
        additionalProperties: true,
        properties: {
          title:       { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string' },
          price_cents: { type: 'integer', minimum: 0 },
          sku:         { type: ['string', 'null'] },
          slug:        { type: ['string', 'null'] },
          status:      { type: 'string', enum: ['active', 'draft', 'archived'] },
          active:      { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const b = req.body as Omit<Product, 'id' | 'created_at' | 'updated_at'>
    const product = await addProduct({
      title:                  b.title,
      description:            b.description ?? '',
      sku:                    b.sku ?? null,
      slug:                   b.slug ?? null,
      handle:                 b.handle ?? null,
      parent_id:              b.parent_id ?? null,
      gtin:                   b.gtin ?? null,
      mpn:                    b.mpn ?? null,
      status:                 b.status ?? 'active',
      visibility:             b.visibility ?? 'public',
      product_type:           b.product_type ?? 'physical',
      featured:               b.featured ?? false,
      is_digital:             b.is_digital ?? false,
      price_cents:            b.price_cents,
      compare_at_price_cents: b.compare_at_price_cents ?? null,
      cost_price_cents:       b.cost_price_cents ?? null,
      currency:               b.currency ?? 'NZD',
      tax_class:              b.tax_class ?? null,
      tax_inclusive:          b.tax_inclusive ?? true,
      pricing_meta:           b.pricing_meta ?? {},
      stock_quantity:         b.stock_quantity ?? 0,
      stock_status:           b.stock_status ?? 'in_stock',
      track_inventory:        b.track_inventory ?? true,
      allow_backorder:        b.allow_backorder ?? false,
      low_stock_threshold:    b.low_stock_threshold ?? null,
      warehouse_location:     b.warehouse_location ?? null,
      lead_time_days:         b.lead_time_days ?? null,
      restock_date:           b.restock_date ?? null,
      has_variants:           b.has_variants ?? false,
      variant_options:        b.variant_options ?? {},
      rating_average:         b.rating_average ?? null,
      rating_count:           b.rating_count ?? 0,
      sales_channels:         b.sales_channels ?? [],
      available_regions:      b.available_regions ?? [],
      content:                b.content ?? {},
      media:                  b.media ?? {},
      specifications:         b.specifications ?? {},
      shipping_info:          b.shipping_info ?? {},
      organisation:           b.organisation ?? {},
      seo:                    b.seo ?? {},
      social_proof:           b.social_proof ?? {},
      digital_product:        b.digital_product ?? {},
      compliance:             b.compliance ?? {},
      active:                 b.active ?? true,
      published_at:           b.published_at ?? null,
    })
    return reply.status(201).send({ product })
  })

  // ── PATCH /commerce/admin/products/:id ───────────────────────────────────
  fastify.patch('/commerce/admin/products/:id', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const product = await editProduct(id, req.body as Partial<Product>)
    return reply.send({ product })
  })

  // ── GET /commerce/admin/products/:id/variants ─────────────────────────────
  fastify.get('/commerce/admin/products/:id/variants', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    return reply.send({ variants: await fetchVariants(id) })
  })

  // ── POST /commerce/admin/products/:id/variants ────────────────────────────
  fastify.post('/commerce/admin/products/:id/variants', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
    schema: {
      body: {
        type: 'object',
        additionalProperties: true,
        properties: {
          sku:           { type: ['string', 'null'] },
          title:         { type: ['string', 'null'] },
          option_values: { type: 'object' },
          price_cents:   { type: ['integer', 'null'], minimum: 0 },
          stock_quantity: { type: 'integer', minimum: 0 },
          is_default:    { type: 'boolean' },
          active:        { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = req.body as Omit<ProductVariant, 'id' | 'product_id' | 'created_at' | 'updated_at'>
    const variant = await addVariant(id, {
      sku:                    b.sku ?? null,
      title:                  b.title ?? null,
      option_values:          b.option_values ?? {},
      price_cents:            b.price_cents ?? null,
      compare_at_price_cents: b.compare_at_price_cents ?? null,
      cost_price_cents:       b.cost_price_cents ?? null,
      stock_quantity:         b.stock_quantity ?? 0,
      stock_status:           b.stock_status ?? 'in_stock',
      track_inventory:        b.track_inventory ?? true,
      allow_backorder:        b.allow_backorder ?? false,
      low_stock_threshold:    b.low_stock_threshold ?? null,
      warehouse_location:     b.warehouse_location ?? null,
      image_id:               b.image_id ?? null,
      weight_grams:           b.weight_grams ?? null,
      is_default:             b.is_default ?? false,
      active:                 b.active ?? true,
    })
    return reply.status(201).send({ variant })
  })

  // ── PATCH /commerce/admin/products/:id/variants/:vid ─────────────────────
  fastify.patch('/commerce/admin/products/:id/variants/:vid', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const { id, vid } = req.params as { id: string; vid: string }
    const variant = await editVariant(id, vid, req.body as Partial<ProductVariant>)
    return reply.send({ variant })
  })

  // ── DELETE /commerce/admin/products/:id/variants/:vid ────────────────────
  fastify.delete('/commerce/admin/products/:id/variants/:vid', {
    preHandler: [verifyBlnkAuth, requireRole('admin', 'super')],
  }, async (req, reply) => {
    const { id, vid } = req.params as { id: string; vid: string }
    await removeVariant(id, vid)
    return reply.status(204).send()
  })
}

export default productsPlugin
