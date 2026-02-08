/**
 * QA Test: Run aiFullAnalysis on 3 brands and audit EVERY output field.
 * Sites: stevemadden.com, fashionnova.com, allbirds.com
 */
import { aiFullAnalysis } from './aiAgent';
import dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const SITES = [
    'stevemadden.com',
    'fashionnova.com',
    'allbirds.com',
];

interface AuditIssue {
    site: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    field: string;
    message: string;
}

async function auditSite(domain: string): Promise<{ result: any; issues: AuditIssue[] }> {
    const issues: AuditIssue[] = [];
    const jobId = `qa-test-${domain.replace(/\./g, '-')}-${Date.now()}`;

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  QA TEST: ${domain}`);
    console.log(`${'='.repeat(70)}\n`);

    const result = await aiFullAnalysis(jobId, domain);

    // ─── AUDIT 1: Site Profile ───
    const sp = result.siteProfile;
    if (!sp) {
        issues.push({ site: domain, severity: 'CRITICAL', field: 'siteProfile', message: 'Missing entirely' });
    } else {
        if (!sp.companyName || sp.companyName.length < 2) {
            issues.push({ site: domain, severity: 'HIGH', field: 'siteProfile.companyName', message: `Invalid: "${sp.companyName}"` });
        }
        if (!sp.industry || sp.industry.length < 2) {
            issues.push({ site: domain, severity: 'MEDIUM', field: 'siteProfile.industry', message: `Invalid: "${sp.industry}"` });
        }
        if (sp.hasSearch === undefined) {
            issues.push({ site: domain, severity: 'HIGH', field: 'siteProfile.hasSearch', message: 'Missing hasSearch boolean' });
        }
        if (!sp.searchType) {
            issues.push({ site: domain, severity: 'HIGH', field: 'siteProfile.searchType', message: 'Missing searchType' });
        }
        if (!sp.visibleCategories || sp.visibleCategories.length === 0) {
            issues.push({ site: domain, severity: 'MEDIUM', field: 'siteProfile.visibleCategories', message: 'No categories detected' });
        }
        if (!sp.aiObservations || sp.aiObservations.length < 10) {
            issues.push({ site: domain, severity: 'LOW', field: 'siteProfile.aiObservations', message: 'Observations too short' });
        }
    }

    // ─── AUDIT 2: Adversarial Testing ───
    const adv = result.adversarial;
    if (!adv) {
        issues.push({ site: domain, severity: 'CRITICAL', field: 'adversarial', message: 'Missing entirely - no adversarial testing ran' });
    } else {
        // Check we tested 3 queries (one per persona)
        if (!adv.queriesTested || adv.queriesTested.length === 0) {
            issues.push({ site: domain, severity: 'CRITICAL', field: 'adversarial.queriesTested', message: 'No queries tested at all' });
        } else if (adv.queriesTested.length < 3) {
            issues.push({ site: domain, severity: 'HIGH', field: 'adversarial.queriesTested', message: `Only ${adv.queriesTested.length}/3 queries tested (expected 3 personas)` });
        }

        // Audit each query
        const queryTexts = new Set<string>();
        for (let i = 0; i < (adv.queriesTested?.length ?? 0); i++) {
            const qt = adv.queriesTested[i];
            const prefix = `adversarial.queriesTested[${i}]`;

            // Check query is non-empty and "natural" (not keyword-stuffed)
            if (!qt.query || qt.query.length < 5) {
                issues.push({ site: domain, severity: 'HIGH', field: `${prefix}.query`, message: `Query too short: "${qt.query}"` });
            }
            if (qt.query && /^[A-Z]/.test(qt.query)) {
                issues.push({ site: domain, severity: 'LOW', field: `${prefix}.query`, message: `Query starts with capital (may not be natural): "${qt.query}"` });
            }
            // Check for keyword-style queries (all caps, separated by commas)
            if (qt.query && qt.query.includes(',')) {
                issues.push({ site: domain, severity: 'MEDIUM', field: `${prefix}.query`, message: `Query looks like keyword list: "${qt.query}"` });
            }

            // Duplicate check
            if (qt.query && queryTexts.has(qt.query.toLowerCase())) {
                issues.push({ site: domain, severity: 'HIGH', field: `${prefix}.query`, message: `DUPLICATE query: "${qt.query}"` });
            }
            queryTexts.add(qt.query?.toLowerCase() ?? '');

            // Reasoning check
            if (!qt.reasoning || qt.reasoning.length < 10) {
                issues.push({ site: domain, severity: 'MEDIUM', field: `${prefix}.reasoning`, message: 'Reasoning missing or too short' });
            }

            // Check relevantResultCount is a real number
            if (qt.relevantResultCount === undefined || qt.relevantResultCount === null) {
                issues.push({ site: domain, severity: 'MEDIUM', field: `${prefix}.relevantResultCount`, message: 'Missing relevantResultCount' });
            }

            // Check screenshot exists
            if (qt.screenshotPath && !fs.existsSync(qt.screenshotPath)) {
                issues.push({ site: domain, severity: 'MEDIUM', field: `${prefix}.screenshotPath`, message: `Screenshot file missing: ${qt.screenshotPath}` });
            }
        }

        // Check proofQuery logic
        if (adv.failedOnAttempt !== null && !adv.proofQuery) {
            issues.push({ site: domain, severity: 'HIGH', field: 'adversarial.proofQuery', message: 'Failure detected but no proof query recorded' });
        }
    }

    // ─── AUDIT 3: Summary ───
    const sum = result.summary;
    if (!sum) {
        issues.push({ site: domain, severity: 'HIGH', field: 'summary', message: 'Missing summary' });
    } else {
        if (!sum.narrative || sum.narrative.length < 20) {
            issues.push({ site: domain, severity: 'MEDIUM', field: 'summary.narrative', message: `Narrative too short: "${sum.narrative?.substring(0, 50)}"` });
        }
        if (!sum.queriesThatWork || sum.queriesThatWork.length === 0) {
            issues.push({ site: domain, severity: 'LOW', field: 'summary.queriesThatWork', message: 'No working queries listed' });
        }
        if (!sum.journeySteps || sum.journeySteps.length === 0) {
            issues.push({ site: domain, severity: 'LOW', field: 'summary.journeySteps', message: 'No journey steps listed' });
        }
        if (!sum.queryInsight || sum.queryInsight.length < 10) {
            issues.push({ site: domain, severity: 'MEDIUM', field: 'summary.queryInsight', message: 'Query insight missing or too short' });
        }
    }

    // ─── AUDIT 4: Comparison/Verdict ───
    const comp = result.comparison;
    if (!comp) {
        issues.push({ site: domain, severity: 'HIGH', field: 'comparison', message: 'Missing comparison object' });
    } else {
        const validVerdicts = ['OUTREACH', 'SKIP', 'REVIEW', 'INCONCLUSIVE'];
        if (!validVerdicts.includes(comp.verdict)) {
            issues.push({ site: domain, severity: 'HIGH', field: 'comparison.verdict', message: `Invalid verdict: "${comp.verdict}"` });
        }
        if (!comp.reason || comp.reason.length < 10) {
            issues.push({ site: domain, severity: 'MEDIUM', field: 'comparison.reason', message: 'Reason too short or missing' });
        }
    }

    return { result, issues };
}

async function main() {
    console.log('\n' + '█'.repeat(70));
    console.log('  HYPER-CRITICAL QA TEST — 3 SITES');
    console.log('  Testing: ' + SITES.join(', '));
    console.log('█'.repeat(70) + '\n');

    const allResults: { domain: string; result: any; issues: AuditIssue[] }[] = [];

    for (const site of SITES) {
        try {
            const { result, issues } = await auditSite(site);
            allResults.push({ domain: site, result, issues });
        } catch (error: any) {
            console.error(`\n❌ FATAL ERROR for ${site}: ${error.message}`);
            allResults.push({
                domain: site,
                result: null,
                issues: [{ site, severity: 'CRITICAL', field: 'EXECUTION', message: `Fatal error: ${error.message}` }],
            });
        }
    }

    // ─── FINAL REPORT ───
    console.log('\n\n' + '█'.repeat(70));
    console.log('  FINAL QA AUDIT REPORT');
    console.log('█'.repeat(70));

    let totalIssues = 0;
    let criticalCount = 0;
    let highCount = 0;

    for (const { domain, result, issues } of allResults) {
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`  ${domain.toUpperCase()}`);
        console.log(`${'─'.repeat(50)}`);

        if (result) {
            // Query summary
            const queries = result.adversarial?.queriesTested ?? [];
            console.log(`  Queries tested: ${queries.length}/3`);
            for (const q of queries) {
                const status = q.passed ? '✓ PASS' : '✗ FAIL';
                console.log(`    [${status}] "${q.query}" → ${q.relevantResultCount ?? '?'} relevant / ${q.resultCount ?? '?'} total`);
                console.log(`           Reasoning: ${q.reasoning?.substring(0, 120)}`);
            }
            console.log(`  Verdict: ${result.comparison?.verdict ?? 'NONE'}`);
            console.log(`  Proof Query: ${result.adversarial?.proofQuery ?? 'None'}`);
        }

        if (issues.length === 0) {
            console.log('  ✅ NO ISSUES FOUND');
        } else {
            console.log(`  ⚠️  ${issues.length} ISSUE(S):`);
            for (const issue of issues) {
                const icon = issue.severity === 'CRITICAL' ? '🔴' : issue.severity === 'HIGH' ? '🟠' : issue.severity === 'MEDIUM' ? '🟡' : '⚪';
                console.log(`    ${icon} [${issue.severity}] ${issue.field}: ${issue.message}`);
            }
        }
        totalIssues += issues.length;
        criticalCount += issues.filter(i => i.severity === 'CRITICAL').length;
        highCount += issues.filter(i => i.severity === 'HIGH').length;
    }

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  TOTALS: ${totalIssues} issues (${criticalCount} critical, ${highCount} high)`);
    console.log(`${'═'.repeat(70)}\n`);

    // Write report to file
    const reportJson = JSON.stringify(allResults.map(({ domain, issues, result }) => ({
        domain,
        queriesTested: result?.adversarial?.queriesTested?.map((q: any) => ({
            query: q.query,
            passed: q.passed,
            relevantResultCount: q.relevantResultCount,
            resultCount: q.resultCount,
            reasoning: q.reasoning,
        })) ?? [],
        verdict: result?.comparison?.verdict,
        proofQuery: result?.adversarial?.proofQuery,
        issues,
    })), null, 2);

    fs.writeFileSync('qa_3site_results.json', reportJson);
    console.log('Report saved to qa_3site_results.json');

    process.exit(totalIssues > 0 ? 1 : 0);
}

main();
