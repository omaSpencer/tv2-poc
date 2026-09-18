import { ApiError } from '../contracts/errors.js';
import { isConnectionFailure } from '../database.js';
import { OperatorActionExecutionError } from './operator-action.error.js';

/**
 * Preserve known domain/dependency errors, translate recognized connection
 * failures, and let programming errors reach the global internal-error path.
 */
export async function dependencyRead<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError || error instanceof OperatorActionExecutionError) throw error;
    if (isConnectionFailure(error)) {
      throw new ApiError('dependency_unavailable', 'An operational dependency is currently unavailable.');
    }
    throw error;
  }
}
