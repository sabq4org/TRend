import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth/auth.guard';
import { ProblemFilter } from './common/problem';
import { APP_CONFIG, type AppConfig } from './config';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { MeController } from './me/me.controller';
import { WorkspacesController } from './workspaces/workspaces.controller';
import { WorkspacesService } from './workspaces/workspaces.service';

// §5: مونوليث معياري. وحدات identity وorg وaudit تبدأ هنا، والبقية تُضاف بمراحلها.
@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [DatabaseModule],
      controllers: [HealthController, MeController, WorkspacesController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
        WorkspacesService,
      ],
      exports: [APP_CONFIG],
    };
  }
}
