import { createHash, randomBytes } from 'crypto';
import { SecureTokenGenerator } from '../../application/security/security.ports';
export class CryptoTokenGenerator implements SecureTokenGenerator { generate() { const raw = randomBytes(32).toString('hex'); return { raw, hash: this.hash(raw) }; } hash(raw: string) { return createHash('sha256').update(raw).digest('hex'); } }
