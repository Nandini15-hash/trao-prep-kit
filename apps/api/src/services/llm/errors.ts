export class LlmError extends Error {
  code:
    | "NO_API_KEY"
    | "RATE_LIMITED"
    | "HTTP_ERROR"
    | "TIMEOUT"
    | "NETWORK_ERROR"
    | "INVALID_JSON"
    | "SCHEMA_INVALID"
    | "EMPTY_RESPONSE"
    | "BLOCKED"
    | "BAD_REQUEST";
  constructor(message: string, code: LlmError["code"]) {
    super(message);
    this.code = code;
  }
}
