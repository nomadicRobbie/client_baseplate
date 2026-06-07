import type { Stripe } from '../../stripe';
import { updateSubscriptionStatus } from '../../../../db/queries/payments';

// v22: Subscription has no current_period_*; derive from start_date /
// billing_cycle_anchor (precise boundaries arrive on invoice events if needed).
function periods(sub: Stripe.Subscription) {
  return {
    currentPeriodStart: new Date(sub.start_date * 1000),
    currentPeriodEnd: new Date(sub.billing_cycle_anchor * 1000),
  };
}

export async function handleSubscriptionUpdated(
  event: Stripe.CustomerSubscriptionUpdatedEvent,
  log: { info: (m: string) => void }
): Promise<void> {
  const sub = event.data.object;
  log.info(`customer.subscription.updated: ${sub.id} → ${sub.status}`);
  await updateSubscriptionStatus({
    stripeSubscriptionId: sub.id,
    status: sub.status,
    ...periods(sub),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
}

export async function handleSubscriptionDeleted(
  event: Stripe.CustomerSubscriptionDeletedEvent,
  log: { info: (m: string) => void }
): Promise<void> {
  const sub = event.data.object;
  log.info(`customer.subscription.deleted: ${sub.id}`);
  await updateSubscriptionStatus({
    stripeSubscriptionId: sub.id,
    status: sub.status,
    ...periods(sub),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
}
