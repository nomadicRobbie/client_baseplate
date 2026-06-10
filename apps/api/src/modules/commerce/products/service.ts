import { listProducts, getProduct, createProduct, updateProduct } from '../../../db/queries/commerce'
import type { Product } from '@blnk/shared'
import { Errors } from '../../../utils/errors'

export async function fetchProducts(): Promise<Product[]> {
  return listProducts(true)
}

export async function fetchProduct(id: string): Promise<Product> {
  const product = await getProduct(id)
  if (!product) throw Errors.notFound('product not found')
  return product
}

export async function addProduct(body: Omit<Product, 'id' | 'created_at' | 'updated_at'>): Promise<Product> {
  return createProduct(body)
}

export async function editProduct(id: string, body: Partial<Omit<Product, 'id' | 'created_at'>>): Promise<Product> {
  const product = await updateProduct(id, body)
  if (!product) throw Errors.notFound('product not found')
  return product
}
