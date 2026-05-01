export type PasswordChecks = {
  minLength: boolean;
  lowercase: boolean;
  uppercase: boolean;
  digit: boolean;
  symbol: boolean;
};

export type PasswordValidationResult = {
  valid: boolean;
  checks: PasswordChecks;
};

export function validatePassword(password: string): PasswordValidationResult {
  const checks: PasswordChecks = {
    minLength: password.length >= 6,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    digit: /\d/.test(password),
    symbol: /[^a-zA-Z0-9]/.test(password),
  };

  const valid = Object.values(checks).every(Boolean);

  return { valid, checks };
}
