import { describe, test, expect } from 'vitest';
import { launchOptions as camoufoxLaunchOptions } from 'camoufox-js';
import { firefox } from 'playwright';

describe('Camoufox Browser Launch Integration Test', () => {
    test('should successfully get launch options and start firefox', async () => {
        // Generate options
        const camoufoxOptions = await camoufoxLaunchOptions({
            headless: true,
        });

        expect(camoufoxOptions).toBeDefined();
        expect(camoufoxOptions).toHaveProperty('executablePath');

        // Attempt launch
        const browser = await firefox.launch({
            ...camoufoxOptions as any,
        });

        expect(browser).toBeDefined();
        
        // Open a page to verify
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto('about:blank');
        const title = await page.title();
        expect(title).toBe('');

        // Cleanup
        await browser.close();
    }, 30000); // 30s timeout since browser launching can take a few seconds
});
