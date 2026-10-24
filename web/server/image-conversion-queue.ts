/**
 * Image conversions made ahead of time: the thumbnails and full views of images agents show in
 * chats, and the Library's figure thumbnails. They run one at a time in the background, so
 * preparing a burst of images never competes with requests or other work for the CPU.
 */
export class ImageConversionQueue {
  private tail: Promise<void> = Promise.resolve();

  /** Runs `job` after the conversions already queued; a failure is logged and the queue goes on. */
  add(label: string, job: () => Promise<unknown>): void {
    this.tail = this.tail.then(job).then(
      () => undefined,
      (error: unknown) => console.warn(`[image-conversions] ${label} failed:`, error),
    );
  }

  /** Resolves once every conversion queued so far has finished. */
  idle(): Promise<void> {
    return this.tail;
  }
}

/** The server's queue, shared by chat images and Library thumbnails. */
export const imageConversionQueue = new ImageConversionQueue();
