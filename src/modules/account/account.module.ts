import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/entities/user.entity';
import { VerificationToken } from '../../database/entities/verification-token.entity';
import { PasswordResetToken } from '../../database/entities/password-reset-token.entity';
import { AuthModule } from '../auth/auth.module';
import { InquiriesModule } from '../inquiries/inquiries.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { AccountQueue } from './account.queue';
import { AccountListener } from './account.listener';
import { AccountMailProcessor } from './account-mail.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, VerificationToken, PasswordResetToken]),
    AuthModule,
    InquiriesModule,
  ],
  controllers: [AccountController],
  providers: [AccountService, AccountQueue, AccountListener, AccountMailProcessor],
  exports: [AccountService],
})
export class AccountModule {}
