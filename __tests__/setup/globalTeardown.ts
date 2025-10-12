import { execSync } from 'child_process';

export default async function globalTeardown() {
  console.log('\n🐳 Stopping mock API container...\n');

  try {
    execSync('docker compose -f docker-compose.test.yml down -v', {
      stdio: 'inherit'
    });
    console.log('✅ Mock API stopped\n');
  } catch (error) {
    console.error('❌ Failed to stop mock API:', error);
    // Don't throw - teardown should be best-effort
  }
}

