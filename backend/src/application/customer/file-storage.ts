export type UploadFile = { buffer: Buffer; mimetype?: string; originalname?: string; size: number };
export type StoredFile = { buffer: Buffer; mimetype: string };
export interface RegistrationFileStorage { save(file: UploadFile, relativeKey: string): Promise<void>; delete(relativeKey: string): Promise<void>; }
export interface FileStorage extends RegistrationFileStorage { read(relativeKey: string): Promise<StoredFile>; replace(file: UploadFile, relativeKey: string): Promise<void>; }
export const FILE_STORAGE = Symbol('FILE_STORAGE');
