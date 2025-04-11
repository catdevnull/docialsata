import { expect, test, describe } from 'bun:test';
import { fetchConfirmationCodeFromEmail } from './email-helper';

describe('Email Helper', () => {
  test('should fetch any Twitter/X confirmation code', async () => {
    const email = 'nzticziorf@rambler.ru';
    const password = '3059217ueoCi8';

    const code = await fetchConfirmationCodeFromEmail(email, password);
    expect(code).toBeDefined();
    console.log('Found confirmation code:', code);
  }, 120000);
});
