import type { FastifyPluginAsync } from 'fastify'
import { verifyBlnkAuth, requireRole } from '../../../blnk/auth'
import { fetchProducts, fetchProduct, addProduct, editProduct } from './service'
import type { Product } from '@blnk/shared'

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
          title:        { type: 'string', minLength: 1, maxLength: 200 },
          description:  { type: 'string' },
          price_cents:  { type: 'integer', minimum: 0 },
          image_url:    { type: ['string', 'null'] },
          postable:     { type: 'boolean' },
          is_new:       { type: 'boolean' },
          active:       { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const b = req.body as Omit<Product, 'id' | 'created_at' | 'updated_at'>
    const product = await addProduct({
      title:        b.title,
      description:  b.description ?? '',
      desc_points:  b.desc_points ?? [],
      price_cents:  b.price_cents,
      image_url:    b.image_url ?? null,
      images:       b.images ?? [],
      sizes:        b.sizes ?? [],
      stock_level:  b.stock_level ?? {},
      postable:     b.postable ?? true,
      is_new:       b.is_new ?? false,
      model_size:   b.model_size ?? false,
      model_details: b.model_details ?? [],
      active:       b.active ?? true,
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
}

export default productsPlugin
