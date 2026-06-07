export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export class AuthError extends GatewayError {
  constructor(requestId?: string) {
    super('API key ausente, inválida o mal configurada', requestId);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends GatewayError {
  constructor(message: string, requestId?: string) {
    super(message, requestId);
    this.name = 'ForbiddenError';
  }
}

export class GatewayValidationError extends GatewayError {
  constructor(detail: string, requestId?: string) {
    super(`Parámetros de consulta inválidos: ${detail}`, requestId);
    this.name = 'GatewayValidationError';
  }
}

export class RateLimitError extends GatewayError {
  constructor(requestId?: string) {
    super('Rate limit o cola llena — espera antes de reintentar', requestId);
    this.name = 'RateLimitError';
  }
}

export class BackendError extends GatewayError {
  constructor(requestId?: string) {
    super('El gateway no pudo consultar el almacenamiento de logs', requestId);
    this.name = 'BackendError';
  }
}

export class UnavailableError extends GatewayError {
  constructor(requestId?: string) {
    super('El gateway no está disponible en este momento', requestId);
    this.name = 'UnavailableError';
  }
}

export class TimeoutError extends GatewayError {
  constructor(timeoutMs: number) {
    super(`La petición superó el timeout de ${timeoutMs}ms y el reintento también falló`);
    this.name = 'TimeoutError';
  }
}

export class NetworkError extends GatewayError {
  constructor(url: string, reason: string) {
    super(`No se pudo conectar al gateway en ${url}: ${reason}`);
    this.name = 'NetworkError';
  }
}
