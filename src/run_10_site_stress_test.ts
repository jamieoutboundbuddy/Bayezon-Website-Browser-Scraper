
import fetch from 'node-fetch';

const SITES = [
    'uniqlo.com',
    'crocs.com',
    'birkenstock.com',
    'stevemadden.com',
    'aritzia.com',
    'neweracap.com',
    'ariat.com',
    'famousfootwear.com',
    'colgate.com',
    'reebok.com'
];

const API_BASE = 'https://bayezon-website-browser-scraper-production.up.railway.app';

async function runTest() {
    console.log(`Starting 10-Site Stress Test on ${API_BASE}...`);
    const jobs: Record<string, string> = {}; // domain -> jobId

    // 1. Trigger all jobs
    for (const domain of SITES) {
        try {
            console.log(`Triggering analysis for: ${domain}`);
            const res = await fetch(`${API_BASE}/api/analyze`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain })
            });

            if (!res.ok) {
                console.error(`Failed to trigger ${domain}: ${res.status} ${res.statusText}`);
                continue;
            }

            const data = await res.json();
            if (data.jobId) {
                jobs[domain] = data.jobId;
                console.log(`  -> Job ID: ${data.jobId}`);
            } else {
                console.error(`  -> No jobId returned for ${domain}`);
            }
        } catch (e) {
            console.error(`Error triggering ${domain}:`, e);
        }
    }

    console.log('\nAll jobs triggered. Polling for results...\n');

    // 2. Poll until completion
    const results: Record<string, any> = {};
    const pending = new Set(Object.keys(jobs));

    while (pending.size > 0) {
        for (const domain of Array.from(pending)) {
            const jobId = jobs[domain];
            try {
                // Short timeout to avoid blocking locally? fetch is async.
                const res = await fetch(`${API_BASE}/api/job/${jobId}`);
                if (!res.ok) continue;

                const jobData = await res.json();

                // Assuming status structure (need to verify API response structure from previous steps)
                // Previous curl output: {"jobId":..., "status":"completed" (implied), ... }
                // Actually the GET /api/job/:id returns the result directly if completed?
                // Or does it return a status object?
                // Let's assume it returns { status: 'pending' | 'completed' | 'failed', result: ... } or similar.
                // Wait, looking at aiAgent.ts, it doesn't seem to have a job queue wrapper in the code I saw.
                // The server.ts probably handles the map.
                // Let's look at server.ts to be sure about the response format.
                // But generally, checks usually return { status: ... }.

                // Inspecting the previous output from step 3366:
                // It returned the FULL result JSON directly. It didn't have a wrapper "status" field at the top level?
                // Wait, step 3366 command output was from the curl command that *started* the job? No, that was the initial POST? 
                // No, step 3307 was the POST. Step 3366 was the *output* of that command!
                // So the POST request *blocks* until completion?
                // "running for 1m28s" in user metadata confirms the POST blocks.

                // AHH! THE API IS SYNCHRONOUS (or at least the POST waits).
                // "curl ... running for 1m28s"
                // And the output in 3366 contained the full result.

                // If the API blocks, I should NOT run them sequentially in a single script thread if I want speed.
                // I should spawn them in parallel.

            } catch (e) {
                console.error(`Error polling ${domain}:`, e);
            }
        }
        await new Promise(r => setTimeout(r, 5000));
    }
}

// RE-PLAN:
// Since the API blocks, I can't blindly "trigger then poll".
// I have to fire 10 requests in parallel (Promises) and wait for them.
// But 10 concurrent requests might overload the single-instance Railway server (browsers are heavy).
// Stagehand/Playwright is resource intensive.
// "Max concurrency" might be an issue.
// I should run them in batches of 2-3.

async function runBatch() {
    const BATCH_SIZE = 2; // Conservative to avoid crashing the server

    for (let i = 0; i < SITES.length; i += BATCH_SIZE) {
        const batch = SITES.slice(i, i + BATCH_SIZE);
        console.log(`\n=== Running Batch ${i / BATCH_SIZE + 1}: ${batch.join(', ')} ===`);

        await Promise.all(batch.map(async (domain) => {
            try {
                console.log(`[${domain}] Starting analysis...`);
                const res = await fetch(`${API_BASE}/api/analyze`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ domain })
                });

                if (res.ok) {
                    const data = await res.json();
                    console.log(`[${domain}] COMPLETED. Verdict: ${data.comparison?.verdict}`);
                    // Save result to file?
                    // I'll log it to console and we can grab it from logs, or write to disk.
                    console.log(JSON.stringify({ domain, result: data }, null, 2));
                } else {
                    console.error(`[${domain}] FAILED: ${res.status}`);
                }
            } catch (e) {
                console.error(`[${domain}] ERROR:`, e);
            }
        }));
    }
}

runBatch();
