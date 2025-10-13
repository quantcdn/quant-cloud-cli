import { execSync } from 'child_process';

export default async function globalTeardown() {
  // Skip Docker management in CI - service container is managed by GitHub Actions
  if (process.env.CI || process.env.GITHUB_ACTIONS) {
    console.log('\n✅ Running in CI - mock API service will be stopped by GitHub Actions\n');
    return;
  }

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

