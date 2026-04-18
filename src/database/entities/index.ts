import { Asset } from './asset.entity';
import { DailyStat } from './daily-stat.entity';
import { DomainVerification } from './domain-verification.entity';
import { Inquiry } from './inquiry.entity';
import { OAuthAccount } from './oauth-account.entity';
import { PageView } from './page-view.entity';
import { PasswordResetToken } from './password-reset-token.entity';
import { Portfolio } from './portfolio.entity';
import { PortfolioRevision } from './portfolio-revision.entity';
import { Session } from './session.entity';
import { Tenant } from './tenant.entity';
import { User } from './user.entity';
import { VerificationToken } from './verification-token.entity';

export const ALL_ENTITIES = [
  User,
  Session,
  OAuthAccount,
  VerificationToken,
  PasswordResetToken,
  Tenant,
  Portfolio,
  PortfolioRevision,
  Asset,
  DomainVerification,
  Inquiry,
  PageView,
  DailyStat,
] as const;

export {
  Asset,
  DailyStat,
  DomainVerification,
  Inquiry,
  OAuthAccount,
  PageView,
  PasswordResetToken,
  Portfolio,
  PortfolioRevision,
  Session,
  Tenant,
  User,
  VerificationToken,
};
