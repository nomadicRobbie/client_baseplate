import { createEnquiry, listEnquiries } from '../../../db/queries/commerce'
import { sendEmail } from '../../../blnk/client'
import type { Enquiry } from '@blnk/shared'

export async function submitEnquiry(body: Omit<Enquiry, 'id' | 'created_at'>): Promise<Enquiry> {
  const enquiry = await createEnquiry(body)

  await sendEmail({
    to: body.email,
    subject: `We received your enquiry — ${body.enquiry_ref}`,
    html: `
      <h2>Hi ${body.name},</h2>
      <p>Thanks for getting in touch. We've received your message and will get back to you soon.</p>
      <blockquote>${body.message}</blockquote>
    `,
  }).catch(() => {})

  return enquiry
}

export async function fetchEnquiries(): Promise<Enquiry[]> {
  return listEnquiries()
}
