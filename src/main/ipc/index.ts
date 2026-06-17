import { BackendManager } from '../backend/manager';
import { registerInferenceHandlers } from './inference';
import { registerFileHandlers } from './file';
import { registerAppHandlers } from './app';

export function registerAllHandlers(backend: BackendManager): void {
  registerInferenceHandlers(backend);
  registerFileHandlers();
  registerAppHandlers(backend);
}
