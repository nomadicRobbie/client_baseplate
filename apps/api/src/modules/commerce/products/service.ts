import {
  listProducts, getProduct, createProduct, updateProduct,
  listVariants, getVariant, createVariant, updateVariant, deleteVariant,
} from '../../../db/queries/commerce'
import type { Product, ProductVariant } from '@blnk/shared'
import { Errors } from '../../../utils/errors'

export async function fetchProducts(activeOnly = true): Promise<Product[]> {
  return listProducts(activeOnly)
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
