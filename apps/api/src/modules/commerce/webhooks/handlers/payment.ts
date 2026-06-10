import type { Stripe } from '../../../payments/stripe'
import { updateOrderPaymentStatus } from '../../../../db/queries/commerce'

export async function handlePaymentIntentSucceeded(event: Stripe.Event): Promise<void> {
  const intent = event.data.object as Stripe.PaymentIntent
  await updateOrderPaymentStatus(intent.id, 'paid')
}

export async function handlePaymentIntentFailed(event: Stripe.Event): Promise<void> {
  const intent = event.data.object as Stripe.PaymentIntent
  await updateOrderPaymentStatus(intent.id, 'failed')
}
