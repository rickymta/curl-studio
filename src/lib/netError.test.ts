import { describe, expect, it } from 'vitest';

import { explainError } from './netError';

describe('explainError', () => {
  it('recognises a refused connection and names the target', () => {
    const e = explainError(
      'error sending request for url (http://localhost:18099/auth/login): client error (Connect): tcp connect error: No connection could be made because the target machine actively refused it. (os error 10061)',
    );
    expect(e.kind).toBe('refused');
    expect(e.target).toBe('localhost:18099');
    expect(e.title).toContain('localhost:18099');
  });

  it('classifies DNS, TLS, timeout and URL errors', () => {
    expect(explainError('dns error: failed to lookup address information: No such host is known. (os error 11001)').kind).toBe('dns');
    expect(explainError('invalid peer certificate: UnknownIssuer').kind).toBe('tls');
    expect(explainError('timed out: request').kind).toBe('timeout');
    expect(explainError('invalid URL ``: empty host').kind).toBe('url');
    expect(explainError('something odd').kind).toBe('other');
  });
});
