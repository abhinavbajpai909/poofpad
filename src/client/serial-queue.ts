export type SerialQueue = (task: () => Promise<void>) => void;

/** Runs async tasks one at a time, in the order they were queued. A failed task does not stop later ones. */
export function createSerialQueue(): SerialQueue {
  let tail: Promise<void> = Promise.resolve();
  return (task) => {
    tail = tail.then(task).catch(() => {
      // eslint-disable-next-line no-console
      console.error("internal error");
    });
  };
}
