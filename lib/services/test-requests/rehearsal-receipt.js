import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function syncDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function reserveRehearsalReceipt(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const descriptor = fs.openSync(filePath, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, serialize(value));
    fs.fsyncSync(descriptor);
  } catch (error) {
    fs.closeSync(descriptor);
    try { fs.unlinkSync(filePath); } catch { /* preserve the original write error */ }
    throw error;
  }
  fs.closeSync(descriptor);
  syncDirectory(directory);
  return filePath;
}

export function updateRehearsalReceipt(filePath, value) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const payload = serialize(value);
  let descriptor = null;
  try {
    descriptor = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, payload);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempPath, filePath);
    syncDirectory(directory);
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    try { fs.unlinkSync(tempPath); } catch { /* rename or write may already have removed it */ }
    throw error;
  }
}
