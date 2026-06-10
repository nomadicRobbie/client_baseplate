import type { ErrorResponse } from '@blnk/shared'

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// Thin typed wrapper over $fetch. All module composables call through here so
// the base URL and error shape are consistent in one place.
export function useApi() {
  const config = useRuntimeConfig()
  const baseURL = config.public.apiUrl as string

  async function get<T>(path: string): Promise<T> {
    return request<T>('GET', path)
  }

  async function post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('POST', path, body)
  }

  async function patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>('PATCH', path, body)
  }

  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    try {
      return await $fetch<T>(`${baseURL}${path}`, {
        method,
        body: body as Record<string, unknown> | undefined,
      })
    } catch (err: unknown) {
      const raw = (err as { data?: ErrorResponse })?.data
      if (raw?.error) {
        throw new ApiError(raw.error.code, raw.error.message, raw.error.status)
      }
      throw err
    }
  }

  return { get, post, patch }
}
