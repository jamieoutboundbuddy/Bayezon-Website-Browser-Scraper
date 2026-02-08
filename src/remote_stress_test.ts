import { parse } from 'csv-parse/sync';
import fs from 'fs';

const TARGET_URL = process.argv[2] || process.env.RAILWAY_URL;

if (!TARGET_URL) {
    console.error("Please provide the target URL (e.g., https://my-app.up.railway.app) as the first argument or set RAILWAY_URL env var.");
    process.exit(1);
}

// Fixed list of 10 sites for stress testing
const domains = [
    "birkenstock.com",
    "neweracap.com",
    "uniqlo.com",
    "crocs.com",
    "aritzia.com",
    "famousfootwear.com",
    "stevemadden.com",
    "macys.com",
    "pacsun.com",
    "gymshark.com"
];

async function runTest() {
    // Ensure URL doesn't end with slash
    const baseUrl = TARGET_URL.replace(/\/$/, '');
    console.log(`Starting stress test against: ${baseUrl}`);

    const results: any[] = [];

    for (const domain of domains) {
        console.log(`\n----------------------------------------`);
        console.log(`Testing ${domain}...`);
        const startTime = Date.now();

        try {
            const response = await fetch(`${baseUrl}/api/analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ domain })
            });

            let data;
            try {
                data = await response.json();
            } catch (e) {
                data = { error: "Invalid JSON response" };
            }

            const duration = (Date.now() - startTime) / 1000;

            if (response.ok) {
                console.log(`✅ ${domain}: SUCCESS (${duration.toFixed(1)}s)`);
                console.log(`   Verdict: ${data.comparison?.verdict}`);
                if (data.confidence) console.log(`   Confidence: ${data.confidence.level}`);
                // Log brief summary
                if (data.comparison?.verdictReason) {
                    console.log(`   Reason: ${data.comparison.verdictReason}`);
                }

                results.push({
                    domain,
                    status: 'success',
                    verdict: data.comparison?.verdict,
                    duration
                });
            } else {
                console.log(`❌ ${domain}: FAILED (${duration.toFixed(1)}s)`);
                console.log(`   Error: ${data.error || response.statusText}`);
                if (data.hint) console.log(`   Hint: ${data.hint}`);

                results.push({
                    domain,
                    status: 'failed',
                    error: data.error,
                    duration
                });
            }

        } catch (e: any) {
            console.log(`❌ ${domain}: NETWORK ERROR - ${e.message}`);
            results.push({
                domain,
                status: 'network_error',
                error: e.message
            });
        }
    }

    console.log(`\n========================================`);
    console.log(`SUMMARY`);
    console.log(`========================================`);
    const successCount = results.filter(r => r.status === 'success').length;
    console.log(`Total: ${results.length}`);
    console.log(`Success: ${successCount}`);
    console.log(`Failed: ${results.length - successCount}`);

    if (results.length - successCount > 0) {
        console.log(`\nFailed Domains:`);
        results.filter(r => r.status !== 'success').forEach(r => {
            console.log(`- ${r.domain}: ${r.error}`);
        });
    }
}

runTest();
