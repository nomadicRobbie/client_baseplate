import { getStripe } from './stripe';
import { getAuthMe } from '../../blnk/client';
import { findStripeCustomer, createStripeCustomer } from '../../db/queries/payments';

// Ensure the END USER has a Stripe customer on the client's account. Idempotent.
// Pulls email/name from blnk_auth (identity) using the user's own token.
export async function ensureStripeCustomer(userId: string, userToken: string): Promise<string> {
  const existing = await findStripeCustomer(userId);
  if (existing) return existing.stripe_customer_id;

  const me = await getAuthMe(userToken);
  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: me.email,
    name: me.name ?? undefined,
    metadata: { user_id: userId },
  });
  await createStripeCustomer(userId, customer.id);
  return customer.id;
}
