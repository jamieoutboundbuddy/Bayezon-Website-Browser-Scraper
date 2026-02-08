
/**
 * Helper function to scroll down the page to trigger lazy loading
 */
export async function autoScroll(page: any): Promise<void> {
    console.log('  [Utils] Scrolling to trigger lazy loading...');
    try {
        await page.evaluate(async () => {
            await new Promise<void>((resolve) => {
                let totalHeight = 0;
                const distance = 300;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;

                    // Scroll 2 viewports deep, then stop
                    if (totalHeight >= window.innerHeight * 2) {
                        clearInterval(timer);
                        window.scrollTo(0, 0); // Go back up
                        resolve();
                    }
                }, 100);
            });
        });
        await new Promise(r => setTimeout(r, 500)); // Settle after scroll
    } catch (e) {
        console.log('  [Utils] Auto-scroll failed (ignoring):', e);
    }
}

/**
 * Helper function to wait for product cards to render
 */
export async function waitForProducts(page: any): Promise<void> {
    console.log('  [Utils] Waiting for product cards to render...');
    try {
        // Common selectors for product grids/cards
        // We define them inside the function to ensure serialization works easily if needed,
        // but here we pass them as argument.
        const selectors = [
            '[class*="product"]',
            '[class*="Product"]',
            '[class*="grid"]',
            '[class*="card"]',
            '[class*="result"]',
            'img[src*="product"]',
            'a[href*="/product/"]',
            'a[href*="/products/"]',
            // Site specific
            '.product-tile', // Uniqlo
            '.ok-card',      // Crocs
            '.ok-card__product-name'
        ];

        // Use evaluate directly to avoid serialization complexity with waitForFunction arguments in some environments
        await page.waitForFunction((selectors: string[]) => {
            // @ts-ignore
            return selectors.some(s => document.querySelector(s));
        }, { timeout: 5000 }, selectors);

        console.log('  [Utils] ✓ Product content detected');
    } catch (e) {
        console.log('  [Utils] ⚠ No standard product selectors found (continuing anyway)');
    }
}
