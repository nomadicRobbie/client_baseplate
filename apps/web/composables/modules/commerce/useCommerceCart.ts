import type { CartItem } from '@blnk/shared'

const CART_KEY = 'blnk_cart'

// Cart state is global (useState) and persisted to localStorage on client.
// SSR renders with an empty cart; client hydrates from localStorage on mount.
export function useCommerceCart() {
  assertCommerceEnabled()

  const items = useState<CartItem[]>('commerce:cart', () => [])

  // Hydrate from localStorage once on client.
  if (import.meta.client) {
    onMounted(() => {
      try {
        const stored = localStorage.getItem(CART_KEY)
        if (stored) items.value = JSON.parse(stored) as CartItem[]
      } catch {}
    })

    // Persist to localStorage whenever cart changes.
    watch(items, (val) => {
      try { localStorage.setItem(CART_KEY, JSON.stringify(val)) } catch {}
    }, { deep: true })
  }

  function addItem(item: Omit<CartItem, 'quantity'> & { quantity?: number }): void {
    const key = cartKey(item)
    const existing = items.value.find(i => cartKey(i) === key)
    if (existing) {
      existing.quantity += item.quantity ?? 1
    } else {
      items.value = [...items.value, { ...item, quantity: item.quantity ?? 1 }]
    }
  }

  function removeItem(productId: string, selectedSize: string | null): void {
    const key = `${productId}:${selectedSize ?? ''}`
    items.value = items.value.filter(i => cartKey(i) !== key)
  }

  function updateQuantity(productId: string, selectedSize: string | null, quantity: number): void {
    const key = `${productId}:${selectedSize ?? ''}`
    if (quantity <= 0) {
      removeItem(productId, selectedSize)
      return
    }
    items.value = items.value.map(i => cartKey(i) === key ? { ...i, quantity } : i)
  }

  function clearCart(): void {
    items.value = []
  }

  const totalCents = computed(() =>
    items.value.reduce((sum, i) => sum + i.price_cents * i.quantity, 0),
  )

  const count = computed(() =>
    items.value.reduce((sum, i) => sum + i.quantity, 0),
  )

  return { items, totalCents, count, addItem, removeItem, updateQuantity, clearCart }
}

function cartKey(item: Pick<CartItem, 'product_id' | 'selected_size'>): string {
  return `${item.product_id}:${item.selected_size ?? ''}`
}
