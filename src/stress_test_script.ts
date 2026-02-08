import { aiFullAnalysis } from './aiAgent';
import dotenv from 'dotenv';

dotenv.config();

console.log('Starting Stress Test on Steve Madden...');
const domain = 'stevemadden.com';
const jobId = 'stress-test-' + Date.now();

async function run() {
    try {
        const result = await aiFullAnalysis(jobId, domain);
        console.log('Analysis Complete');
        console.log('--- RESULT SUMMARY ---');
        console.log(JSON.stringify(result.summary, null, 2));
        console.log('--- ADVERSARIAL DATA ---');
        console.log(JSON.stringify(result.adversarial, null, 2));

        // Check if we ran 3 times
        if (result.adversarial?.queriesTested.length === 3) {
            console.log('SUCCESS: Ran 3 queries as expected.');
        } else {
            console.log(`WARNING: Ran ${result.adversarial?.queriesTested.length} queries (expected 3).`);
        }

    } catch (error) {
        console.error('Test Failed:', error);
    }
    process.exit(0);
}

run();
