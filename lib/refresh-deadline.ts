export interface DeadlineOutcome<T> {
  /** True when deadlineMs elapsed before `work` settled. */
  timedOut: boolean;
  /** The work's result, or null when the deadline fired first. */
  value: T | null;
}

/**
 * Hard-deadline race: resolves with the work's value, or with
 * { timedOut: true, value: null } once deadlineMs passes.
 *
 * Plain timer instead of racing an AbortSignal: on 10-20 refresh-releases'
 * shard calls hung for hours past their abort signal and never logged, so
 * the lib grew this race (lib/refresh-releases.ts). A caller that must print
 * partials and exit wraps its refresh in this and treats `timedOut` as the
 * kill signal. The timer is always cleared, so a fast result leaves no
 * dangling handle keeping the process open.
 */
export function raceWithDeadline<T>(
  work: Promise<T>,
  deadlineMs: number
): Promise<DeadlineOutcome<T>> {
  // If the deadline settles the race first and `work` rejects afterwards,
  // this shadow handler keeps the rejection from becoming an unhandled
  // rejection that would crash the process mid-exit.
  work.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"deadline">((resolve) => {
    timer = setTimeout(() => resolve("deadline"), deadlineMs);
  });

  return Promise.race([
    work.then((value): DeadlineOutcome<T> => ({ timedOut: false, value })),
    deadline.then((): DeadlineOutcome<T> => ({ timedOut: true, value: null })),
  ]).finally(() => clearTimeout(timer));
}
