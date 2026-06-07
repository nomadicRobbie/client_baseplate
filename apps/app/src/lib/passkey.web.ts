import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

// Web passkey implementation — selected by Metro on web only, so
// @simplewebauthn/browser is never bundled into the native app.
export const passkeySupported = true;

export async function doRegister(optionsJSON: unknown): Promise<unknown> {
  return startRegistration({ optionsJSON: optionsJSON as PublicKeyCredentialCreationOptionsJSON });
}

export async function doAuthenticate(optionsJSON: unknown): Promise<unknown> {
  return startAuthentication({ optionsJSON: optionsJSON as PublicKeyCredentialRequestOptionsJSON });
}
