import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/entities/user.entity';
import { VerificationToken } from '../../database/entities/verification-token.entity';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, VerificationToken]), AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
