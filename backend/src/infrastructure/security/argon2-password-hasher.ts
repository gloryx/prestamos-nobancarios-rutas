import * as argon2 from 'argon2';
import { PasswordHasher } from '../../application/security/security.ports';
export class Argon2PasswordHasher implements PasswordHasher { hash(value: string) { return argon2.hash(value, { type: argon2.argon2id }); } verify(hash: string, value: string) { return argon2.verify(hash, value); } }
