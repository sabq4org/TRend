import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { ProblemFilter } from './common/problem';
import { APP_CONFIG, type AppConfig } from './config';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { InvitationsController, InvitationsService } from './invitations/invitations.controller';
import { MAIL_TRANSPORT, transportFor, type MailTransport } from './mail/transport';
import { MailWorker } from './mail/worker';
import { MeController } from './me/me.controller';
import { WorkspacesController } from './workspaces/workspaces.controller';
import { WorkspacesService } from './workspaces/workspaces.service';

export interface AppOverrides {
  /** الاختبارات تلتقط البريد بدل إرساله. */
  mailTransport?: MailTransport;
}

// §5: مونوليث معياري. وحدات identity وorg وaudit تبدأ هنا، والبقية تُضاف بمراحلها.
@Module({})
export class AppModule {
  static forRoot(config: AppConfig, overrides: AppOverrides = {}): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [DatabaseModule, AuthModule],
      controllers: [HealthController, MeController, WorkspacesController, InvitationsController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
        { provide: MAIL_TRANSPORT, useValue: overrides.mailTransport ?? transportFor(config) },
        MailWorker,
        WorkspacesService,
        InvitationsService,
      ],
      exports: [APP_CONFIG],
    };
  }
}
