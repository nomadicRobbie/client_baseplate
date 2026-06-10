import type { Enquiry } from '@blnk/shared'

export function useCommerceEnquiry() {
  assertCommerceEnabled()
  const { post } = useApi()

  async function submitEnquiry(body: {
    name: string
    email: string
    subject?: string
    message: string
  }): Promise<Enquiry> {
    const ref = `ENQ-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
    const data = await post<{ enquiry: Enquiry }>('/commerce/enquiries', {
      enquiry_ref: ref,
      ...body,
    })
    return data.enquiry
  }

  return { submitEnquiry }
}
