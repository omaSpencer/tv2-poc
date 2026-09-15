/**
 * Mutable config bag for M3 Nest test assemblies.
 */
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

let values: Record<string, string | number> = {};

export function setRelayTestConfig(next: Record<string, string | number>): void {
  values = { ...next };
}

function relayTestConfigService(): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (!(key in values)) throw new Error('Missing test config key: ' + key);
      return values[key];
    },
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useFactory: () => relayTestConfigService(),
    },
  ],
  exports: [ConfigService],
})
export class RelayTestConfigModule {}
