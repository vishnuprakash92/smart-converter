# Smart Converter (MVP)

Local Chrome extension that detects currency, temperature and time on pages and shows converted values per user preferences.

Install for testing:

1. Open Chrome -> Extensions -> Load unpacked
2. Select the `chrome_plugin/smart-converter` folder
3. Open `sample-page.html` in the browser and hover over values (100 USD, 72°F, 9:00 AM PST)
4. Open the extension popup to change preferences

Notes:
- All conversions are local. Rates are hardcoded (1 USD = 83 INR, 1 EUR = 90 INR, 1 GBP = 100 INR).
- Timezones use fixed offsets, no DST.
