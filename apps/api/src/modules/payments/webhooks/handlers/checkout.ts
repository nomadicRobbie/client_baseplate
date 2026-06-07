import type { Stripe } from '../../stripe';
import { getStripe } from '../../stripe';
import { markPaymentBySession, upsertSubscription, findStripeCustomerByStripeId } from '../../../../db/queries/payments';

// checkout.session.completed — fires for both one-off (mode=payment) and
// subscription (mode=subscription) success.
export async function handleCheckoutCompleted(
  event: Stripe.CheckoutSessionCompletedEvent,
  log: { info: (m: string) => void; warn: (m: string) => void }
): Promise<void> {
  const session = event.data.object;

  if (session.mode === 'payment') {
    const pi = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null;
    log.info(`checkout.session.completed (payment): ${session.id}`);
    await markPaymentBySession(session.id, 'paid', pi);
    return;
  }

  if (session.mode === 'subscription') {
    const subId = typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id;
    if (!subId) { log.warn(`subscription session ${session.id} had no subscription`); return; }

    // Resolve the user from our customer mapping (fallback to session metadata).
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? '';
    const mapped = await findStripeCustomerByStripeId(customerId);
    const userId = mapped?.user_id ?? (session.metadata?.user_id as string | undefined);
    if (!userId) { log.warn(`subscription session ${session.id} — unknown user`); return; }

    // Fetch the subscription to capture price + period.
    const sub = await getStripe().subscriptions.retrieve(subId);
    const item = sub.items.data[0];
    log.info(`checkout.session.completed (subscription): ${subId} → ${sub.status}`);
    await upsertSubscription({
      userId,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: customerId,
      stripePriceId: item?.price.id ?? '',
      status: sub.status,
      currentPeriodStart: new Date(sub.start_date * 1000),
      currentPeriodEnd: new Date(sub.billing_cycle_anchor * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    });
  }
}
