import { getStripe } from '../stripe';
import type { Stripe } from '../stripe';
import { ensureStripeCustomer } from '../customers';
import { Errors } from '../../../utils/errors';
import { listSubscriptions, findSubscriptionByStripeId, type Subscription } from '../../../db/queries/payments';

export interface Plan {
  price_id: string; product_name: string; unit_amount: number; currency: string; interval: string;
}

// List the client's subscription plans straight from THEIR Stripe account — Stripe
// is the source of truth. Active recurring prices, with their product expanded.
// (To curate, filter on a product/price metadata flag, e.g. show_in_app=true.)
export async function listPlans(): Promise<Plan[]> {
  const stripe = getStripe();
  const prices = await stripe.prices.list({ active: true, type: 'recurring', expand: ['data.product'], limit: 50 });
  return prices.data
    .filter((p) => {
      const product = p.product as Stripe.Product;
      return product && !('deleted' in product && product.deleted) && product.active !== false;
    })
    .map((p) => {
      const product = p.product as Stripe.Product;
      return {
        price_id: p.id,
        product_name: product.name ?? 'Plan',
        unit_amount: p.unit_amount ?? 0,
        currency: p.currency,
        interval: p.recurring?.interval ?? 'month',
      };
    });
}

// Create a subscription Checkout Session (mode=subscription) for a price.
// price_id comes from the client's Stripe product catalogue (source of truth).
export async function createSubscriptionCheckout(data: {
  userId: string; userToken: string; priceId: string; successUrl: string; cancelUrl: string;
}): Promise<{ url: string }> {
  // Guard: don't start a second active subscription.
  const existing = await listSubscriptions(data.userId);
  if (existing.some((s) => ['active', 'trialing', 'past_due'].includes(s.status))) {
    throw Errors.badGateway('you already have an active subscription');
  }

  const customerId = await ensureStripeCustomer(data.userId, data.userToken);
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: data.priceId, quantity: 1 }],
    success_url: data.successUrl,
    cancel_url: data.cancelUrl,
    metadata: { user_id: data.userId, kind: 'subscription' },
  });
  return { url: session.url! };
}

export async function listMySubscriptions(userId: string): Promise<Subscription[]> {
  return listSubscriptions(userId);
}

// Cancel at period end (keeps access until the period ends).
export async function cancelMySubscription(userId: string, id: string): Promise<void> {
  const sub = await findSubscriptionByStripeId(id);
  if (!sub || sub.user_id !== userId) throw Errors.notFound('subscription');
  await getStripe().subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
}
