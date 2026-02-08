import { parse } from 'csv-parse/sync';
import fs from 'fs';

const TARGET_URL: string = process.argv[2] || process.env.RAILWAY_URL || '';

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
    const baseUrl = (TARGET_URL || '').replace(/\/$/, '');
    console.log(`Starting stress test against: ${baseUrl}`);



    const promises = domains.map(async (domain) => {
        console.log(`Starting test for ${domain}...`);
        const startTime = Date.now();

        try {
            // 5-minute timeout per site
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

            const response = await fetch(`${baseUrl}/api/analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ domain }),
                signal: controller.signal
            });
            clearTimeout(timeout);

            let data;
            try {
                data = await response.json();
            } catch (e) {
                data = { error: "Invalid JSON response" };
            }

            const duration = (Date.now() - startTime) / 1000;

            if (response.ok) {
                const msg = [
                    `✅ ${domain}: SUCCESS (${duration.toFixed(1)}s)`,
                    `   Verdict: ${data.comparison?.verdict}`,
                    data.confidence ? `   Confidence: ${data.confidence.level}` : null,
                    data.comparison?.verdictReason ? `   Reason: ${data.comparison.verdictReason}` : null,
                    data.jobId ? `   Job ID: ${data.jobId}` : null,
                    data.jobId ? `   Screenshot: ${baseUrl}/artifacts/${data.jobId}/${domain.replace(/^www\./, '')}/screens/results.png` : null
                ].filter(Boolean).join('\n');
                console.log(msg);

                return {
                    domain,
                    status: 'success',
                    verdict: data.comparison?.verdict,
                    duration
                };
            } else {
                const msg = [
                    `❌ ${domain}: FAILED (${duration.toFixed(1)}s)`,
                    `   Error: ${data.error || response.statusText}`,
                    data.hint ? `   Hint: ${data.hint}` : null
                ].filter(Boolean).join('\n');
                console.log(msg);

                return {
                    domain,
                    status: 'failed',
                    error: data.error,
                    duration
                };
            }

        } catch (e: any) {
            console.log(`❌ ${domain}: NETWORK ERROR - ${e.message}`);
            return {
                domain,
                status: 'network_error',
                error: e.message
            };
        }
    });

    const results = await Promise.all(promises);

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
