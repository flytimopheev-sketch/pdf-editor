/** Centralized error handling for PDF Editor */

export type ErrorSeverity = 'info' | 'warning' | 'error';

interface ErrorContext {
  action: string;
  error: unknown;
  severity?: ErrorSeverity;
  silent?: boolean; // if true, only log to console
}

/** Map of error patterns to user-friendly Russian messages */
const ERROR_MESSAGES: Record<string, string> = {
  'Failed to fetch': 'Ошибка сети: проверьте подключение к интернету',
  'Invalid PDF': 'Неверный формат PDF-файла',
  'PasswordException': 'PDF защищён паролем. Пароли не поддерживаются.',
  'Worker error': 'Ошибка модуля рендеринга. Перезагрузите страницу.',
  'quota': 'Недостаточно места для хранения. Очистите localStorage.',
  'SecurityError': 'Ошибка безопасности: действие заблокировано браузером.',
  'AbortError': 'Действие отменено пользователем.',
};

function matchErrorMessage(error: unknown): string | null {
  const str = String(error);
  for (const [pattern, message] of Object.entries(ERROR_MESSAGES)) {
    if (str.includes(pattern)) return message;
  }
  return null;
}

/** 
 * Handle errors consistently across the app.
 * - Logs to console with structured format
 * - Shows user-friendly alert (unless silent)
 * - Returns true if error was handled
 */
export function handleError(ctx: ErrorContext): void {
  const { action, error, severity = 'error', silent = false } = ctx;
  const errorStr = String(error);

  // Log to console with structured format
  const prefix = { info: 'ℹ️', warning: '⚠️', error: '❌' }[severity];
  console.error(`${prefix} [PDF Editor] ${action}:`, error);

  // AbortError = user cancelled, don't show anything
  if (error instanceof Error && error.name === 'AbortError') return;
  if (errorStr.includes('AbortError')) return;

  if (silent) return;

  // Try to match a known error pattern
  const friendlyMessage = matchErrorMessage(error);
  if (friendlyMessage) {
    alert(friendlyMessage);
    return;
  }

  // Generic fallback
  const label = { info: '', warning: 'Внимание: ', error: 'Ошибка: ' }[severity];
  alert(`${label}${action}\n\n${errorStr.length > 200 ? errorStr.slice(0, 200) + '...' : errorStr}`);
}

/** Wrap an async function with centralized error handling */
export function withErrorHandling<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  action: string,
  options?: { severity?: ErrorSeverity; silent?: boolean }
): T {
  return ((...args: Parameters<T>) => {
    return fn(...args).catch((error) => {
      handleError({ action, error, ...options });
      throw error; // re-throw so caller can handle too
    });
  }) as T;
}

/** Create a processing wrapper that sets isProcessing and handles errors */
export function createProcessingHandler(
  setProcessing: (v: boolean) => void,
  action: string
) {
  return async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    setProcessing(true);
    try {
      return await fn();
    } catch (error) {
      handleError({ action, error });
      return undefined;
    } finally {
      setProcessing(false);
    }
  };
}
