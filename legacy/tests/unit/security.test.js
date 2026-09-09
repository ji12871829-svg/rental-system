// Unit tests for the password policy (validate at the schema level).
const { passwordSchema } = require('../../server/src/utils/validationSchemas');

describe('passwordSchema', () => {
  it('accepts a compliant password', () => {
    expect(passwordSchema.safeParse('ChangeMe123!').success).toBe(true);
  });

  it('rejects passwords shorter than 8 characters', () => {
    expect(passwordSchema.safeParse('Ab1!x').success).toBe(false);
  });

  it('rejects passwords without at least one number', () => {
    expect(passwordSchema.safeParse('OnlyLetters!').success).toBe(false);
  });

  it('accepts exactly 8 characters with a digit', () => {
    expect(passwordSchema.safeParse('abcdefg1').success).toBe(true);
  });
});