/** Errors safe to return through the public API. Unexpected errors are redacted. */
export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message); this.name = 'AppError'; this.status = status;
    this.code = code; this.details = details;
  }
}
export const fail = (status, code, message, details) => { throw new AppError(status, code, message, details); };
export const requireValue = (condition, message, code = 'VALIDATION') => {
  if (!condition) fail(400, code, message);
};
export function expectedVersion(record, expected) {
  if (expected === undefined || expected === null || expected === '') {
    fail(400, 'VERSION_REQUIRED', 'Reopen this record before saving; its version is missing.');
  }
  if (String(expected) !== String(record.version)) {
    fail(409, 'STALE_VERSION', 'This record changed. Your edits were not saved. Reload it and review the newer version.');
  }
}
