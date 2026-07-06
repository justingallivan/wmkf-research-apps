/**
 * Test script for user profiles
 */

const path = require('path');
const fs = require('fs');

// Load env
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        let value = valueParts.join('=');
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  });
  console.log('Loaded environment variables from .env.local');
}

const { enterDynamicsBypassForScript } = require('../lib/services/dynamics-context');
enterDynamicsBypassForScript('test-profiles');

const { DatabaseService } = require('../lib/services/database-service');

async function test() {
  try {
    // Check existing profiles first
    console.log('\n1. Checking existing profiles...');
    let profiles = await DatabaseService.getUserProfiles();
    console.log(`   Found ${profiles.length} existing profile(s)`);

    if (profiles.length === 0) {
      // Create a test profile
      console.log('\n2. Creating test profile...');
      const profile = await DatabaseService.createUserProfile({
        name: 'Test User',
        displayName: 'Test User',
        avatarColor: '#6366f1',
        isDefault: true
      });
      console.log('   Created profile:', profile.id, '-', profile.name);

      // List all profiles again
      profiles = await DatabaseService.getUserProfiles();
    }

    const testProfile = profiles[0];
    console.log('\n3. Using profile:', testProfile.id, '-', testProfile.name);

    // Test setting a preference (non-encrypted)
    console.log('\n4. Testing preference storage...');
    await DatabaseService.setUserPreference(testProfile.id, 'test_setting', 'test_value', false);
    console.log('   Set test_setting = test_value');

    // Test setting an encrypted preference
    console.log('\n5. Testing encrypted preference (API key)...');
    await DatabaseService.setUserPreference(testProfile.id, 'api_key_claude', 'sk-test-fake-key-12345', true);
    console.log('   Set api_key_claude (encrypted)');

    // Retrieve preferences (masked)
    console.log('\n6. Retrieving preferences (masked)...');
    const maskedPrefs = await DatabaseService.getUserPreferences(testProfile.id, false);
    console.log('   Preferences:', JSON.stringify(maskedPrefs, null, 2));

    // Retrieve decrypted API key
    console.log('\n7. Retrieving decrypted API key...');
    const apiKey = await DatabaseService.getDecryptedApiKey(testProfile.id, 'api_key_claude');
    console.log('   Decrypted key:', apiKey);

    // Clean up test preference
    console.log('\n8. Cleaning up test preferences...');
    await DatabaseService.deleteUserPreference(testProfile.id, 'test_setting');
    await DatabaseService.deleteUserPreference(testProfile.id, 'api_key_claude');
    console.log('   Deleted test preferences');

    console.log('\n✓ All profile tests passed!');

  } catch (err) {
    console.error('\n✗ Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

test().then(() => process.exit(0));
