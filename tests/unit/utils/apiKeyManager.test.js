/**
 * Unit tests for API Key Manager utilities
 */

import crypto from 'crypto';
import { ApiKeyManager, getApiKeyManager } from '../../../shared/utils/apiKeyManager';

// Mock environment variables
const originalEnv = process.env;

describe('ApiKeyManager', () => {
  let apiKeyManager;

  beforeEach(() => {
    apiKeyManager = new ApiKeyManager();
    // Clear any cached instances
    jest.clearAllMocks();
    
    // Reset process.env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Constructor', () => {
    test('creates instance with default configuration', () => {
      expect(apiKeyManager).toBeInstanceOf(ApiKeyManager);
      expect(apiKeyManager.keyCache).toBeDefined();
      expect(apiKeyManager.cacheTimeout).toBe(3600000); // 1 hour
    });
  });

  describe('encryptForClient', () => {
    test('encrypts API key for client storage', () => {
      const apiKey = 'sk-ant-test-api-key';
      const encrypted = apiKeyManager.encryptForClient(apiKey);
      
      expect(encrypted).toHaveProperty('encrypted');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('authTag');
      expect(encrypted).toHaveProperty('timestamp');
      expect(typeof encrypted.encrypted).toBe('string');
      expect(typeof encrypted.iv).toBe('string');
      expect(typeof encrypted.authTag).toBe('string');
      expect(typeof encrypted.timestamp).toBe('number');
    });

    test('generates different encryption for same key', () => {
      const apiKey = 'sk-ant-test-key';
      const encrypted1 = apiKeyManager.encryptForClient(apiKey);
      const encrypted2 = apiKeyManager.encryptForClient(apiKey);
      
      // Should be different due to random IV
      expect(encrypted1.encrypted).not.toBe(encrypted2.encrypted);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    test('handles encryption errors gracefully', () => {
      // Spy on the imported `crypto` module — Node's crypto is a singleton,
      // so the spy applies to the same instance apiKeyManager.js imported.
      // (The pre-S188 skipped version mocked `global.crypto.scryptSync`,
      // which is not what apiKeyManager.js calls — hence the skip.)
      const spy = jest.spyOn(crypto, 'scryptSync').mockImplementation(() => {
        throw new Error('Crypto error');
      });
      try {
        const brokenApiKeyManager = new ApiKeyManager();
        expect(() => brokenApiKeyManager.encryptForClient('test')).toThrow('Failed to encrypt API key');
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('decryptFromClient', () => {
    test('decrypts previously encrypted data', () => {
      const apiKey = 'sk-ant-test-api-key-for-decryption';
      const encrypted = apiKeyManager.encryptForClient(apiKey);
      const decrypted = apiKeyManager.decryptFromClient(encrypted);
      
      expect(decrypted).toBe(apiKey);
    });

    test('handles decryption errors gracefully', () => {
      const invalidEncrypted = {
        encrypted: 'invalid',
        iv: 'invalid',
        authTag: 'invalid'
      };
      
      expect(() => apiKeyManager.decryptFromClient(invalidEncrypted)).toThrow('Failed to decrypt API key');
    });
  });

  describe('generateSessionToken', () => {
    test('generates unique session tokens', () => {
      const apiKey = 'sk-ant-test-key';
      const token1 = apiKeyManager.generateSessionToken(apiKey);
      const token2 = apiKeyManager.generateSessionToken(apiKey);
      
      expect(token1).not.toBe(token2);
      expect(typeof token1).toBe('string');
      expect(typeof token2).toBe('string');
      expect(token1.length).toBeGreaterThan(10);
    });

    test('stores API key in cache', () => {
      const apiKey = 'sk-ant-cached-key';
      const token = apiKeyManager.generateSessionToken(apiKey);
      
      expect(apiKeyManager.keyCache.has(token)).toBe(true);
      
      const cached = apiKeyManager.keyCache.get(token);
      expect(cached.apiKey).toBe(apiKey);
      expect(cached.timestamp).toBeDefined();
    });

    test('calls cleanup during token generation', () => {
      const cleanupSpy = jest.spyOn(apiKeyManager, 'cleanupExpiredTokens');
      apiKeyManager.generateSessionToken('sk-ant-test');
      
      expect(cleanupSpy).toHaveBeenCalled();
    });
  });

  describe('getApiKeyFromToken', () => {
    test('retrieves API key from valid token', () => {
      const apiKey = 'sk-ant-retrievable-key';
      const token = apiKeyManager.generateSessionToken(apiKey);
      const retrieved = apiKeyManager.getApiKeyFromToken(token);
      
      expect(retrieved).toBe(apiKey);
    });

    test('returns null for invalid token', () => {
      const retrieved = apiKeyManager.getApiKeyFromToken('invalid-token');
      
      expect(retrieved).toBeNull();
    });

    test('returns null for expired token', () => {
      const apiKey = 'sk-ant-expired-key';
      const token = apiKeyManager.generateSessionToken(apiKey);
      
      // Mock expired timestamp
      const session = apiKeyManager.keyCache.get(token);
      session.timestamp = Date.now() - (apiKeyManager.cacheTimeout + 1000);
      
      const retrieved = apiKeyManager.getApiKeyFromToken(token);
      
      expect(retrieved).toBeNull();
      expect(apiKeyManager.keyCache.has(token)).toBe(false);
    });

    test('refreshes timestamp on successful retrieval', () => {
      const apiKey = 'sk-ant-refresh-key';
      const token = apiKeyManager.generateSessionToken(apiKey);
      
      const originalTimestamp = apiKeyManager.keyCache.get(token).timestamp;
      
      // Wait a moment
      setTimeout(() => {
        const retrieved = apiKeyManager.getApiKeyFromToken(token);
        const newTimestamp = apiKeyManager.keyCache.get(token).timestamp;
        
        expect(retrieved).toBe(apiKey);
        expect(newTimestamp).toBeGreaterThan(originalTimestamp);
      }, 10);
    });
  });

  describe('validateApiKeyFormat', () => {
    test('validates correct Claude API key format', () => {
      const validKeys = [
        'sk-ant-api03-1234567890abcdef',
        'sk-ant-api01-abcdefghijklmnop',
        'sk-ant-1234567890123456'
      ];
      
      validKeys.forEach(key => {
        expect(apiKeyManager.validateApiKeyFormat(key)).toBe(true);
      });
    });

    test('rejects invalid key formats', () => {
      const invalidKeys = [
        'invalid-key',
        'sk-openai-1234567890',
        'sk-ant-',
        'sk-ant',
        '',
        null,
        undefined,
        123
      ];
      
      invalidKeys.forEach(key => {
        expect(apiKeyManager.validateApiKeyFormat(key)).toBe(false);
      });
    });

    test('handles keys with extra whitespace', () => {
      const keyWithSpaces = '  sk-ant-api01-1234567890abcdef  ';
      expect(apiKeyManager.validateApiKeyFormat(keyWithSpaces)).toBe(true);
    });
  });

  describe('cleanupExpiredTokens', () => {
    test('removes expired tokens from cache', () => {
      const apiKey = 'sk-ant-cleanup-test';
      const token = apiKeyManager.generateSessionToken(apiKey);
      
      // Manually expire the token
      const session = apiKeyManager.keyCache.get(token);
      session.timestamp = Date.now() - (apiKeyManager.cacheTimeout + 1000);
      
      apiKeyManager.cleanupExpiredTokens();
      
      expect(apiKeyManager.keyCache.has(token)).toBe(false);
    });

    test('keeps valid tokens in cache', () => {
      const apiKey = 'sk-ant-valid-token';
      const token = apiKeyManager.generateSessionToken(apiKey);
      
      apiKeyManager.cleanupExpiredTokens();
      
      expect(apiKeyManager.keyCache.has(token)).toBe(true);
    });

    test('handles empty cache gracefully', () => {
      apiKeyManager.keyCache.clear();
      
      expect(() => apiKeyManager.cleanupExpiredTokens()).not.toThrow();
    });
  });

  describe('getServerApiKey', () => {
    test('returns server API key when available', () => {
      process.env.CLAUDE_API_KEY = 'sk-ant-server-key-12345';
      
      const serverKey = apiKeyManager.getServerApiKey();
      
      expect(serverKey).toBe('sk-ant-server-key-12345');
    });

    test('returns null when no server key configured', () => {
      delete process.env.CLAUDE_API_KEY;
      
      const serverKey = apiKeyManager.getServerApiKey();
      
      expect(serverKey).toBeNull();
    });

    test('returns null for invalid server key format', () => {
      process.env.CLAUDE_API_KEY = 'invalid-server-key';
      
      const serverKey = apiKeyManager.getServerApiKey();
      
      expect(serverKey).toBeNull();
    });
  });

  describe('selectApiKey', () => {
    test('prefers server key over client key', () => {
      process.env.CLAUDE_API_KEY = 'sk-ant-server-priority';
      const clientKey = 'sk-ant-client-key-12345';
      
      const selected = apiKeyManager.selectApiKey(clientKey);
      
      expect(selected).toBe('sk-ant-server-priority');
    });

    test('falls back to client key when no server key', () => {
      delete process.env.CLAUDE_API_KEY;
      const clientKey = 'sk-ant-fallback-client';
      
      const selected = apiKeyManager.selectApiKey(clientKey);
      
      expect(selected).toBe(clientKey);
    });

    test('throws error when no valid key available', () => {
      delete process.env.CLAUDE_API_KEY;
      
      expect(() => apiKeyManager.selectApiKey('')).toThrow('No valid API key available');
      expect(() => apiKeyManager.selectApiKey('invalid')).toThrow('No valid API key available');
      expect(() => apiKeyManager.selectApiKey(null)).toThrow('No valid API key available');
    });

    test('validates both server and client keys', () => {
      process.env.CLAUDE_API_KEY = 'invalid-server';
      const clientKey = 'sk-ant-valid-client-key';
      
      const selected = apiKeyManager.selectApiKey(clientKey);
      
      expect(selected).toBe(clientKey);
    });
  });
});

describe('getApiKeyManager singleton', () => {
  test('returns same instance on multiple calls', () => {
    const manager1 = getApiKeyManager();
    const manager2 = getApiKeyManager();
    
    expect(manager1).toBe(manager2);
    expect(manager1).toBeInstanceOf(ApiKeyManager);
  });

  test('creates new instance on first call', () => {
    const manager = getApiKeyManager();
    
    expect(manager).toBeInstanceOf(ApiKeyManager);
    expect(manager.keyCache).toBeDefined();
  });
});