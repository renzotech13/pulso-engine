export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ConfigError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "CONFIG_ERROR", cause);
    this.name = "ConfigError";
  }
}

export class TenantIsolationError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "TENANT_ISOLATION_ERROR", cause);
    this.name = "TenantIsolationError";
  }
}

export class AgentExecutionError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, "AGENT_EXECUTION_ERROR", cause);
    this.name = "AgentExecutionError";
  }
}
