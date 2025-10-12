import { execSync } from 'child_process';
import { setTimeout } from 'timers/promises';

export default async function globalSetup() {
  console.log('\n🐳 Starting mock API container...\n');

  try {
    // Stop any existing containers
    try {
      execSync('docker compose -f docker-compose.test.yml down -v', { 
        stdio: 'ignore' 
      });
    } catch {
      // Ignore errors if containers don't exist
    }

    // Start the mock API container
    execSync('docker compose -f docker-compose.test.yml up -d', {
      stdio: 'inherit'
    });

    // Wait for the container to be healthy
    console.log('⏳ Waiting for mock API to be ready...');
    
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      try {
        const result = execSync(
          'docker inspect --format="{{.State.Health.Status}}" quant-mock-api-test',
          { encoding: 'utf-8' }
        ).trim();
        
        if (result === 'healthy') {
          console.log('✅ Mock API is ready!\n');
          // Give it an extra second to fully stabilise
          await setTimeout(1000);
          return;
        }
        
        // Show status for debugging
        if (attempts % 5 === 0 && attempts > 0) {
          console.log(`  Status: ${result} (attempt ${attempts}/${maxAttempts})`);
        }
      } catch (error) {
        // Container might not be ready yet
      }
      
      attempts++;
      await setTimeout(1000);
    }
    
    // Show logs before failing
    console.error('\n❌ Mock API failed to become healthy. Container logs:');
    try {
      execSync('docker logs quant-mock-api-test', { stdio: 'inherit' });
    } catch {
      // Ignore if logs can't be shown
    }
    
    throw new Error('Mock API failed to become healthy');
  } catch (error) {
    console.error('❌ Failed to start mock API:', error);
    throw error;
  }
}

