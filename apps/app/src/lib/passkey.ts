// Native passkey stub. The web implementation lives in passkey.web.ts and is
// selected automatically by Metro on web. Native passkeys (react-native-passkeys
// + associated domains) land when the native app build is done.
export const passkeySupported = false;

export async function doRegister(_optionsJSON: unknown): Promise<unknown> {
  throw new Error('passkeys on native are not wired yet (use email OTP)');
}

export async function doAuthenticate(_optionsJSON: unknown): Promise<unknown> {
  throw new Error('passkeys on native are not wired yet (use email OTP)');
}
