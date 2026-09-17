export class OperatorActionExecutionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OperatorActionExecutionError';
  }
}
