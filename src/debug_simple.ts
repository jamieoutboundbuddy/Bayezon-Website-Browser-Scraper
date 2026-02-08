console.log("1. Starting debug_simple.ts");
try {
    const { analyzeWebsite } = await import('./aiAgent');
    console.log("2. Imported analyzeWebsite successfully");
} catch (e) {
    console.error("2. Import failed:", e);
}
console.log("3. Done");
