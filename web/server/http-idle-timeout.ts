/**
 * Seconds an HTTP connection to the server may send nothing before Bun closes
 * it. Bun's default, 10 s, closed every request that waits longer for an
 * answer, such as `takode exec`'s long polls (`MAX_WAIT_SECONDS`), so a
 * foreground `takode exec` running more than about two minutes failed with
 * "socket connection was closed unexpectedly". 255 s is Bun's maximum.
 */
export const HTTP_IDLE_TIMEOUT_SECONDS = 255;
