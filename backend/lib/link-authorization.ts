import { SecurityError } from './security-error';

/** No persistent session/generation registry exists in the current JWT model.
 * Legacy timestamp + password proof cannot establish revocability. No flag or
 * client-supplied claim enables linking until that architecture is approved.
 */
export function assertRevocableLinkingAvailable(): never {
  throw new SecurityError('LINK_AUTHORIZATION_GENERATION_REQUIRED',503);
}
