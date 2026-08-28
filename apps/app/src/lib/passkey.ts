import { isSupported, create, get } from 'react-native-passkeys';

export const passkeySupported = isSupported();

export async function doRegister(optionsJSON: unknown): Promise<unknown> {
  return create(optionsJSON as Parameters<typeof create>[0]);
}

export async function doAuthenticate(optionsJSON: unknown): Promise<unknown> {
  return get(optionsJSON as Parameters<typeof get>[0]);
}
