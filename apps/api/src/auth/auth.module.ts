import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleOAuthService } from './google-oauth.service';
import { AuthGuard } from './guards';
import { MailerService } from './mailer.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret && process.env.NODE_ENV === 'production') {
          throw new Error('JWT_SECRET must be set in production');
        }
        return { secret: secret ?? 'surfgen-dev-secret-do-not-use-in-prod' };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleOAuthService,
    MailerService,
    PrismaService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, PrismaService, JwtModule],
})
export class AuthModule {}
