// Stripe v22 (`export =` CJS). Default import is the constructor (value); the
// namespace TYPES (Stripe.Event, Stripe.Checkout.Session, …) come from
// stripe/cjs/stripe.core. The client's OWN Stripe account.
import StripeLib from 'stripe';
import type { Stripe } from 'stripe/cjs/stripe.core';
import { config } from '../../config';

export type { Stripe };

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new StripeLib(config.stripe.apiKey, { apiVersion: '2026-05-27.dahlia' }) as Stripe;
  }
  return _stripe;
}

// Verify webhook signature against the raw body. The webhook plugin keeps the raw
// Buffer and stays ENCAPSULATED (NOT fastify-plugin) so its parser doesn't leak.
export function constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
  return getStripe().webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret) as Stripe.Event;
}
