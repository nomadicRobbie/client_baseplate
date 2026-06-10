import type { Product } from '@blnk/shared'

export function useCommerceProducts() {
  assertCommerceEnabled()
  const { get } = useApi()

  async function listProducts(): Promise<Product[]> {
    const data = await get<{ products: Product[] }>('/commerce/products')
    return data.products
  }

  async function getProduct(id: string): Promise<Product> {
    const data = await get<{ product: Product }>(`/commerce/products/${id}`)
    return data.product
  }

  return { listProducts, getProduct }
}
