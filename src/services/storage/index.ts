import { AsyncStorageAdapter } from './AsyncStorageAdapter';

export type { StorageAdapter } from './StorageAdapter';
export { AsyncStorageAdapter } from './AsyncStorageAdapter';

export const defaultStorage = new AsyncStorageAdapter();
