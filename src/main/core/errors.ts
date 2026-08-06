/**
 * Central error type.
 *
 * Every error surfaced to the user is a LauncherError with a *friendly,
 * actionable* message. Raw technical detail goes to the log files — never
 * to the user's face.
 */
export class LauncherError extends Error {
  /** Stable machine-readable code for debugging. */
  readonly code: string
  /** Hint shown under the message, e.g. how to fix it or where to look. */
  readonly hint?: string

  constructor(code: string, message: string, hint?: string) {
    super(message)
    this.name = 'LauncherError'
    this.code = code
    this.hint = hint
  }

  static wrap(err: unknown, code = 'UNKNOWN', message = 'Something went wrong.', hint?: string): LauncherError {
    if (err instanceof LauncherError) return err
    const detail = err instanceof Error ? err.message : String(err)
    return new LauncherError(code, `${message} (${detail})`, hint)
  }
}

/** Helper builders for the most common failure classes. */
export const Errors = {
  network(hint = 'Check your internet connection and try again.') {
    return new LauncherError('NETWORK', 'The launcher could not reach a required server.', hint)
  },
  notConfigured(what: string, hint?: string) {
    return new LauncherError('NOT_CONFIGURED', `${what} is not configured yet.`, hint)
  },
  notLoggedIn() {
    return new LauncherError(
      'NOT_LOGGED_IN',
      'You need to log in with your Microsoft account first.',
      'Open the account panel and choose "Login with Microsoft".'
    )
  },
  missingJava(required: number) {
    return new LauncherError(
      'JAVA_NOT_FOUND',
      `Minecraft ${required > 0 ? `requires Java ${required} ` : ''}but no compatible Java installation was found.`,
      'Install a compatible JDK or point to one in Settings → Java path.'
    )
  },
  launchFailed(detail: string) {
    return new LauncherError(
      'LAUNCH_FAILED',
      'Minecraft failed to launch.',
      `Possible reason: ${detail} Check the logs for more details.`
    )
  }
}
