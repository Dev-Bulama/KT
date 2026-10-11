/** Errors whose message is safe to show to the end user. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = "APP_ERROR",
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You are not authorised to perform this action.") {
    super(message, "FORBIDDEN", 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "The requested record was not found.") {
    super(message, "NOT_FOUND", 404);
    this.name = "NotFoundError";
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Please sign in to continue.") {
    super(message, "UNAUTHENTICATED", 401);
    this.name = "UnauthenticatedError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "This record was changed by someone else. Reload and try again.") {
    super(message, "CONFLICT", 409);
    this.name = "ConflictError";
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message, "VALIDATION", 422);
    this.name = "ValidationError";
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many attempts. Please wait and try again.") {
    super(message, "RATE_LIMITED", 429);
    this.name = "RateLimitError";
  }
}
