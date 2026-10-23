/**
 * Turns anything thrown by Supabase (PostgrestError / StorageError objects,
 * which are not Error instances), fetch or our own code into a readable
 * sentence, so the UI never shows "[object Object]".
 */
export function getErrorMessage(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object") {
    const { message, error_description: description } = err as {
      message?: unknown;
      error_description?: unknown;
    };
    if (typeof message === "string" && message.trim()) return message;
    if (typeof description === "string" && description.trim()) return description;
  }
  return fallback;
}

/**
 * supabase.functions.invoke() reports any non-2xx response as a generic
 * "Edge Function returned a non-2xx status code". The function's own
 * `{ error }` body is on `error.context` (a Response); read it when present.
 */
export async function getFunctionErrorMessage(err: unknown, fallback: string): Promise<string> {
  const context = (err as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) return body.error;
    } catch {
      // Not JSON; fall through to the generic message.
    }
  }
  return getErrorMessage(err, fallback);
}
