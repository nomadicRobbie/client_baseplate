export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly message: string,
    public readonly statusCode: number = 400
  ) {
    super(message)
    this.name = 'AppError'
    ;(this as unknown as Record<string, unknown>)['statusCode'] = statusCode
  }
}

export const Errors = {
  badRequest: (msg = 'bad request') => new AppError('BAD_REQUEST', msg, 400),
  unauthorized: (msg = 'unauthorized') => new AppError('UNAUTHORIZED', msg, 401),
  forbidden: (msg = 'forbidden') => new AppError('FORBIDDEN', msg, 403),
  notFound: (resource: string) => new AppError('NOT_FOUND', `${resource} not found`, 404),
  badGateway: (msg = 'upstream error') => new AppError('BAD_GATEWAY', msg, 502),
  internal: (msg = 'internal server error') => new AppError('INTERNAL_ERROR', msg, 500),
} as const
