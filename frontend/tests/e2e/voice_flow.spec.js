const { test, expect } = require('@playwright/test');

test.describe('Voice Flow E2E', () => {
  test('should register, mock speech recognition, record expense, and update UI', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Check if we are on login screen and switch to Register
    const registerTab = page.locator('button:has-text("Register")');
    if (await registerTab.count() > 0) {
      await registerTab.first().click();
    }

    // Generate unique user details
    const randomSuffix = Math.floor(Math.random() * 10000);
    const email = `testuser_${randomSuffix}@example.com`;
    const password = 'Password123!';

    // Fill registration form
    await page.fill('#auth-email', email);
    await page.fill('#auth-name', 'E2E User');
    await page.fill('#auth-password', password);
    await page.fill('#auth-confirm', password);

    // Click submit
    await page.click('button[type="submit"]');

    // Wait until logged in (dashboard elements visible)
    await expect(page.locator('.mic-btn')).toBeVisible();

    // Mock webkitSpeechRecognition on the page
    await page.evaluate(() => {
      window.webkitSpeechRecognition = function() {
        return {
          start: function() {
            if (this.onstart) this.onstart();
            setTimeout(() => {
              if (this.onresult) {
                this.onresult({
                  results: [[{ transcript: "Add 500 to food" }]]
                });
              }
              if (this.onend) this.onend();
            }, 500);
          },
          stop: function() {}
        };
      };
      window.SpeechRecognition = window.webkitSpeechRecognition;
    });

    // Click the mic button
    await page.click('.mic-btn');

    // Verify response message in the status container or toast
    await expect(page.locator('text=Added ₹500.00 to food.')).toBeVisible({ timeout: 15000 });
  });
});

