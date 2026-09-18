import { Module } from '@nestjs/common';
import { MeController } from './me.controller.js';
import { AuthenticatedGuard } from './authenticated.guard.js';
import { OidcDiscovery } from './oidc.js';
import { TokenVerifier } from './token-verifier.js';
import { ObservabilityModule } from '../observability/logger.js';

@Module({
  imports: [ObservabilityModule],
  controllers: [MeController],
  providers: [OidcDiscovery, TokenVerifier, AuthenticatedGuard],
  exports: [OidcDiscovery, TokenVerifier],
})
export class IdentityModule {}
