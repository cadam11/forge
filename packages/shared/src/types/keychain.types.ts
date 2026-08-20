/**
 * Keychain (credential store) types.
 *
 * Only availability crosses the IPC boundary. Credentials themselves never leave the main
 * process — the renderer is told whether the OS credential store is usable, nothing more.
 */

export interface KeychainStatus {
  /**
   * `false` once a keychain read or write has failed. Passwords still work for the rest of
   * the session, held in memory, but nothing is persisted. Availability never comes back
   * within a session: the store does not retry.
   */
  available: boolean;
}
