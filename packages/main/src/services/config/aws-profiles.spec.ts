import { describe, it, expect } from 'vitest';
import { parseAwsProfileNames } from './aws-profiles';

const CONFIG = `
[default]
region = us-east-1

[profile dev]
sso_session = my-sso
region = us-west-2

[profile prod-admin]
region = eu-west-1

[sso-session my-sso]
sso_start_url = https://example.awsapps.com/start
`;

const CREDENTIALS = `
[default]
aws_access_key_id = AKIA...

[legacy-keys]
aws_access_key_id = AKIA...
`;

describe('parseAwsProfileNames', () => {
  it('collects config [profile x] and credentials [x] sections, default first, deduped', () => {
    expect(parseAwsProfileNames(CONFIG, CREDENTIALS)).toEqual([
      'default',
      'dev',
      'prod-admin',
      'legacy-keys',
    ]);
  });

  it('ignores sso-session and services sections', () => {
    expect(parseAwsProfileNames(CONFIG, '')).not.toContain('my-sso');
  });

  it('handles empty inputs', () => {
    expect(parseAwsProfileNames('', '')).toEqual([]);
  });
});
