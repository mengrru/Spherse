export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class ModelNotConfiguredError extends Error {
  constructor() {
    super("Model is not configured. Please select a model in Settings.");
    this.name = "ModelNotConfiguredError";
  }
}

export class MigrationRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationRequiredError";
  }
}
