/**
 * The largest linked file Takode downloads to the browser's device. A remote host's file crosses
 * the host link in one message, as a linked PDF does, so downloads share the PDF limit.
 */
export const MAX_FILE_LINK_DOWNLOAD_BYTES = 100 * 1024 * 1024;
