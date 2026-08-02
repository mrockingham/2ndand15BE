import type { AccessTokenClaims } from '../security/access-token.js';
import type { AdministrativePrincipal } from '../../modules/admin/admin-authorization.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AccessTokenClaims;
      admin?: AdministrativePrincipal;
    }
  }
}

export {};
