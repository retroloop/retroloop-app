/**
 * `@retro/cli` — the AI-facing driving adapter (L4b).
 *
 * It runs the App in-process over the same database the server uses and never
 * talks to the server, so capture keeps working when nothing is up.
 */
export { EXIT, errorCodeFor, exitCodeFor, ServerError, TimeoutError, UsageError } from '#errors'
export { run } from '#main'
export { createOutput, type Output, type Writer } from '#output'
export { type CliContext, type CliRuntime, createDefaultRuntime, resolveClock } from '#runtime'
export {
  DEFAULT_BIND,
  isLoopbackBind,
  remoteTunnelCommand,
  requireLoopbackBind,
  type ServeAddress,
  tunnelCommandFor,
} from '#server/address'
export { acquireLock, isProcessAlive, type LockInfo, readLock, releaseLock } from '#server/lock'
export { type RunningServer, type ServerHandler, startServer } from '#server/serve'
export {
  DATA_DIRNAME,
  DEFAULT_HOME,
  DEFAULT_PORT,
  LOCK_FILENAME,
  resolveDataDir,
  resolveHome,
  resolveStage,
  type Stage,
} from '#stage'
