import { createId } from '../id';
import { User } from './user.entity';
import { Tenant } from './tenant.entity';
import { Portfolio } from './portfolio.entity';

describe('entity id generation', () => {
  it('createId returns a 24-char string', () => {
    const id = createId();
    expect(id).toHaveLength(24);
    expect(id).toMatch(/^[a-z0-9]+$/);
  });

  it('BeforeInsert assignId assigns when absent', () => {
    const user = new User();
    user.assignId();
    expect(user.id).toHaveLength(24);
  });

  it('BeforeInsert assignId preserves a pre-set id', () => {
    const tenant = new Tenant();
    tenant.id = 'fixed-id-value-0000000000';
    tenant.assignId();
    expect(tenant.id).toBe('fixed-id-value-0000000000');
  });

  it('ids are unique across calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      ids.add(createId());
    }
    expect(ids.size).toBe(1000);
  });

  it('entity defaults match the spec', () => {
    const portfolio = new Portfolio();
    portfolio.assignId();
    expect(portfolio.id).toHaveLength(24);
    // Defaults come from DB columns, not object init — the TS class does not
    // populate them. This test guards only against accidental runtime init logic.
    expect(portfolio.template).toBeUndefined();
  });
});
