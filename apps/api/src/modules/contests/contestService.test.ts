import { resolveAuditActorId } from './contestService';

describe('resolveAuditActorId', () => {
  it('returns null when the actor does not exist', async () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null)
      }
    };

    await expect(resolveAuditActorId(tx as any, 'missing-user')).resolves.toBeNull();
  });

  it('returns the actor id when the user exists', async () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1' })
      }
    };

    await expect(resolveAuditActorId(tx as any, 'user-1')).resolves.toBe('user-1');
  });
});
