import { getStripe } from '../../payments/stripe'
import { config } from '../../../config'
import { createOrder, listOrders, packOrder, fulfillOrder, decrementStock } from '../../../db/queries/commerce'
import { sendEmail } from '../../../blnk/client'
import { Errors } from '../../../utils/errors'
import type { Order, OrderItem, ShippingAddress } from '@blnk/shared'

export async function createPaymentIntent(
  amountCents: number,
  currency: string,
): Promise<{ clientSecret: string; intentId: string }> {
  const stripe = getStripe()
  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: currency ?? config.stripe.currency,
  })
  if (!intent.client_secret) throw Errors.internal('stripe payment intent missing client_secret')
  return { clientSecret: intent.client_secret, intentId: intent.id }
}

export async function submitOrder(body: {
  order_ref: string
  email: string
  name: string
  phone?: string
  shipping_address: ShippingAddress
  items: OrderItem[]
  total_cents: number
  payment_intent_id: string
}): Promise<Order> {
  // Decrement stock for each item before persisting the order.
  for (const item of body.items) {
    if (item.selected_size) {
      await decrementStock(item.product_id, item.selected_size, item.quantity)
    }
  }

  const order = await createOrder({
    ...body,
    phone: body.phone ?? null,
    payment_status: 'pending',
    fulfillment_status: 'pending',
    packed_at: null,
    packed_by: null,
    fulfilled_at: null,
    fulfilled_by: null,
  })

  await sendOrderConfirmation(order).catch(() => {
    // Email failure must not roll back the order.
  })

  return order
}

export async function fetchOrders(fulfillmentStatus?: string): Promise<Order[]> {
  const validStatuses = ['pending', 'packed', 'fulfilled'] as const
  type FS = typeof validStatuses[number]
  const status = validStatuses.includes(fulfillmentStatus as FS)
    ? (fulfillmentStatus as FS)
    : undefined
  return listOrders(status)
}

export async function markPacked(id: string, userId: string): Promise<Order> {
  const order = await packOrder(id, userId)
  if (!order) throw Errors.notFound('order not found or already packed')
  return order
}

export async function markFulfilled(id: string, userId: string): Promise<Order> {
  const order = await fulfillOrder(id, userId)
  if (!order) throw Errors.notFound('order not found or not yet packed')
  return order
}

async function sendOrderConfirmation(order: Order): Promise<void> {
  const itemLines = order.items
    .map(i => `<li>${i.quantity}× ${i.title}${i.selected_size ? ` (${i.selected_size})` : ''} — ${formatCents(i.price_cents * i.quantity)}</li>`)
    .join('')

  await sendEmail({
    to: order.email,
    subject: `Order confirmed — ${order.order_ref}`,
    html: `
      <h2>Thanks for your order, ${order.name}!</h2>
      <p>Your order <strong>${order.order_ref}</strong> has been received.</p>
      <ul>${itemLines}</ul>
      <p><strong>Total: ${formatCents(order.total_cents)}</strong></p>
      <p>We'll be in touch when it's on its way.</p>
    `,
  })
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(cents / 100)
}
