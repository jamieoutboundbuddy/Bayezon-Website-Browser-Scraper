import { analyzeWebsite } from './aiAgent';
import * as dotenv from 'dotenv';
dotenv.config();

// Force local execution
process.env.STAGEHAND_ENV = 'LOCAL';

async function run() {
    const target = process.argv[2] || 'crocs.com';
    console.log(`Debugging search for: ${target}`);

    try {
        const result = await analyzeWebsite(target);
        console.log('----------------------------------------');
        console.log('DEBUG RESULT:');
        console.log(JSON.stringify(result, null, 2));
        console.log('----------------------------------------');
    } catch (error) {
        console.error('DEBUG ERROR:', error);
    }
}

run();
