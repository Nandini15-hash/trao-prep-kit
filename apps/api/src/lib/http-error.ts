export class HttpError extends Error {
  status: number;
  code: string;
  publicMessage: string;

  constructor(status: number, code: string, publicMessage: string) {
    super(publicMessage);
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
  }

  static badRequest(message: string, code = "BAD_REQUEST") {
    return new HttpError(400, code, message);
  }
  static unauthorized(message = "Authentication required", code = "UNAUTHORIZED") {
    return new HttpError(401, code, message);
  }
  static forbidden(message = "Not allowed", code = "FORBIDDEN") {
    return new HttpError(403, code, message);
  }
  static notFound(message = "Not found", code = "NOT_FOUND") {
    return new HttpError(404, code, message);
  }
  static conflict(message: string, code = "CONFLICT") {
    return new HttpError(409, code, message);
  }
}

/** Wraps an async Express handler so rejected promises reach the error middleware. */
export function asyncHandler<T extends (...args: any[]) => Promise<any>>(fn: T) {
  return (req: any, res: any, next: any) => {
    fn(req, res, next).catch(next);
  };
}
