import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { Public } from './guards';

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  name: z.string().min(1).max(120),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RefreshSchema = z.object({ refreshToken: z.string().min(1) });

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Create an account and personal workspace' })
  register(@Body(new ZodValidationPipe(RegisterSchema)) body: z.infer<typeof RegisterSchema>) {
    return this.authService.register(body);
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  @ApiOperation({ summary: 'Exchange credentials for access + refresh tokens' })
  login(@Body(new ZodValidationPipe(LoginSchema)) body: z.infer<typeof LoginSchema>) {
    return this.authService.login(body.email, body.password);
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate a refresh token' })
  refresh(@Body(new ZodValidationPipe(RefreshSchema)) body: z.infer<typeof RefreshSchema>) {
    return this.authService.refresh(body.refreshToken);
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  @ApiOperation({ summary: 'Revoke a refresh token' })
  async logout(@Body(new ZodValidationPipe(RefreshSchema)) body: z.infer<typeof RefreshSchema>) {
    await this.authService.logout(body.refreshToken);
  }
}
