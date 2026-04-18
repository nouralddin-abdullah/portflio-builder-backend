import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthPrincipal } from '../auth/current-user.decorator';
import { UsersService } from './users.service';
import type { UserProfile } from './users.service';
import {
  DeleteAccountDto,
  EmailChangeDto,
  PasswordChangeDto,
  UpdateProfileDto,
} from './schemas';

@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  get(@CurrentUser() principal: AuthPrincipal): Promise<UserProfile> {
    return this.users.getProfile(principal.userId);
  }

  @Patch()
  update(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: UpdateProfileDto,
  ): Promise<UserProfile> {
    return this.users.updateProfile(principal.userId, body);
  }

  @Post('email-change')
  @HttpCode(HttpStatus.NO_CONTENT)
  async emailChange(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: EmailChangeDto,
  ): Promise<void> {
    await this.users.requestEmailChange(principal.userId, body);
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: PasswordChangeDto,
  ): Promise<void> {
    await this.users.changePassword(principal.userId, principal.sessionId, body);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAccount(
    @CurrentUser() principal: AuthPrincipal,
    @Body() body: DeleteAccountDto,
  ): Promise<void> {
    await this.users.deleteAccount(principal.userId, body.password);
  }
}
