/** A blocked audio context must return control to the visitor with a retry. */
export async function audioStartDeadline<T>(promise: Promise<T>, milliseconds = 8000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Sound is waiting for browser permission. Keep this page visible and tap Begin or Start audio again.')), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}
