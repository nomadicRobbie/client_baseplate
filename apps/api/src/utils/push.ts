const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

// Fire-and-forget Expo push sender. Batches into chunks of 100 (Expo's limit).
// Never throws — a push failure must not block the request that triggered it.
// ponytail: add receipt polling via /v2/push/getReceipts if delivery tracking needed.
export function sendPush(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): void {
  const valid = tokens.filter(t => t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken['))
  if (valid.length === 0) return

  for (let i = 0; i < valid.length; i += 100) {
    const messages = valid.slice(i, i + 100).map(to => ({ to, title, body, data, sound: 'default' }))
    fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(messages),
    }).catch(() => {})
  }
}
