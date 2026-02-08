console.log("1. Starting debug_stagehand.ts");
try {
    const { Stagehand } = await import('@browserbasehq/stagehand');
    console.log("2. Imported Stagehand");
    const s = new Stagehand({ env: 'LOCAL', verbose: 1 });
    console.log("3. Created instance");
} catch (e) {
    console.error("Error:", e);
}
