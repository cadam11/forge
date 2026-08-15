#!/usr/bin/env node
// Generates a test-only SSH keypair at tests/.ssh/{id_test, id_test.pub} if
// one doesn't already exist. The public key is mounted into the bastion
// container; the private key is read by the SSH-tunnel integration tests.
//
// The keypair is gitignored (see tests/.gitignore). Each developer machine
// has its own pair generated on first `test:harness:up`.

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const SSH_DIR = join(HERE, '..', '.ssh');
const PRIVATE_KEY = join(SSH_DIR, 'id_test');
const PUBLIC_KEY = join(SSH_DIR, 'id_test.pub');

function ensureKey() {
  if (existsSync(PRIVATE_KEY) && existsSync(PUBLIC_KEY)) {
    console.log(`[ensure-ssh-key] keypair already present at ${SSH_DIR}`);
    return;
  }

  mkdirSync(SSH_DIR, { recursive: true, mode: 0o700 });

  const result = spawnSync(
    'ssh-keygen',
    [
      '-t', 'ed25519',
      '-N', '',
      '-C', 'joinery-test-key (DO NOT USE OUTSIDE TESTS)',
      '-f', PRIVATE_KEY,
    ],
    { stdio: 'inherit' },
  );

  if (result.status !== 0) {
    throw new Error(
      `[ensure-ssh-key] ssh-keygen exited with status ${result.status}. ` +
      `Is OpenSSH installed?`,
    );
  }

  console.log(`[ensure-ssh-key] generated keypair at ${SSH_DIR}`);
}

ensureKey();
