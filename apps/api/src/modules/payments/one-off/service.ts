import { getStripe } from '../stripe';
import { config } from '../../../config';
import { ensureStripeCustomer } from '../customers';
import { createPayment, listPayments, type Payment } from '../../../db/queries/payments';

// Create a one-off Checkout Session (mode=payment) for an ad-hoc amount.
// Stripe hosts the payment page; we get a URL to redirect the user to.
export async function createOneOffCheckout(data: {
  userId: string; userToken: string; amountCents: number; description: string;
  successUrl: string; cancelUrl: string; currency?: string;
}): Promise<{ url: string; payment: Payment }> {
  const customerId = await ensureStripeCustomer(data.userId, data.userToken);
  const currency = (data.currency ?? config.stripe.currency).toLowerCase();
  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [{
      quantity: 1,
      price_data: {
        currency,
        unit_amount: data.amountCents,
        product_data: { name: data.description },
      },
    }],
    success_url: data.successUrl,
    cancel_url: data.cancelUrl,
    metadata: { user_id: data.userId, kind: 'one_off' },
    // payment_method_types intentionally omitted — dynamic payment methods.
  });

  const payment = await createPayment({
    userId: data.userId,
    sessionId: session.id,
    amountCents: data.amountCents,
    currency,
    description: data.description,
  });

  return { url: session.url!, payment };
}

export async function listMyPayments(userId: string): Promise<Payment[]> {
  return listPayments(userId);
}
