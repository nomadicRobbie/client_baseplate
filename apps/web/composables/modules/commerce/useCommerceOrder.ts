import type { Order, OrderItem, ShippingAddress } from '@blnk/shared'

export function useCommerceOrder() {
  assertCommerceEnabled()
  const { post } = useApi()

  async function createIntent(amountCents: number, currency?: string): Promise<{ clientSecret: string; intentId: string }> {
    return post<{ clientSecret: string; intentId: string }>('/commerce/orders/intent', {
      amount_cents: amountCents,
      currency,
    })
  }

  async function submitOrder(body: {
    order_ref: string
    email: string
    name: string
    phone?: string
    shipping_address: ShippingAddress
    items: OrderItem[]
    total_cents: number
    payment_intent_id: string
  }): Promise<Order> {
    const data = await post<{ order: Order }>('/commerce/orders', body)
    return data.order
  }

  return { createIntent, submitOrder }
}
