/**
 * Encryption utilities for user preferences
 *
 * Uses AES-256-GCM for encrypting sensitive data like API keys.
 * The encryption key should be set via USER_PREFS_ENCRYPTION_KEY env var.
 *
 * In development, falls back to a hardcoded key (not secure for production).
 */

const crypto = require('crypto');

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 16 bytes for GCM
const AUTH_TAG_LENGTH = 16; // 16 bytes for GCM auth tag

/**
 * Get the encryption key from environment or use dev fallback
 * For production, USER_PREFS_ENCRYPTION_KEY must be set as a 32-byte hex string
 */
function getEncryptionKey() {
  const keyFromEnv = process.env.USER_PREFS_ENCRYPTION_KEY;

  if (keyFromEnv) {
    // Key should be a 64-character hex string (32 bytes)
    if (keyFromEnv.length === 64) {
      return Buffer.from(keyFromEnv, 'hex');
    }
    // If it's a plain string, hash it to get consistent 32 bytes
    return crypto.createHash('sha256').update(keyFromEnv).digest();
  }

  // In production, refuse to use a fallback key
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'USER_PREFS_ENCRYPTION_KEY is not set. Cannot encrypt/decrypt user preferences in production.'
    );
  }

  // Development fallback - NOT SECURE FOR PRODUCTION
  console.warn('USER_PREFS_ENCRYPTION_KEY not set - using development fallback key');
  return crypto.createHash('sha256').update('dev-fallback-key-not-for-production').digest();
}

/**
 * Encrypt a string value
 * @param {string} plaintext - The value to encrypt
 * @returns {string} Base64-encoded encrypted value (IV + authTag + ciphertext)
 */
function encrypt(plaintext) {
  if (!plaintext) return null;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Combine IV + authTag + ciphertext and encode as base64
  const combined = Buffer.concat([
    iv,
    authTag,
    Buffer.from(encrypted, 'hex')
  ]);

  return combined.toString('base64');
}

/**
 * Decrypt an encrypted value
 * @param {string} encryptedBase64 - Base64-encoded encrypted value
 * @returns {string|null} Decrypted plaintext or null if decryption fails
 */
function decrypt(encryptedBase64) {
  if (!encryptedBase64) return null;

  try {
    const key = getEncryptionKey();
    const combined = Buffer.from(encryptedBase64, 'base64');

    // Extract IV, authTag, and ciphertext
    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error.message);
    return null;
  }
}

/**
 * Mask a sensitive value for display
 * @param {string} value - The value to mask
 * @param {number} showFirst - Number of characters to show at start
 * @param {number} showLast - Number of characters to show at end
 * @returns {string} Masked value
 */
function maskValue(value, showFirst = 3, showLast = 3) {
  if (!value || value.length < showFirst + showLast + 2) {
    return '••••••••';
  }
  return `${value.substring(0, showFirst)}••••${value.substring(value.length - showLast)}`;
}

/**
 * Generate a new random encryption key (for initial setup)
 * @returns {string} 64-character hex string suitable for USER_PREFS_ENCRYPTION_KEY
 */
function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  encrypt,
  decrypt,
  maskValue,
  generateEncryptionKey
};
