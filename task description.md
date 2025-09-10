📝 GitHub Copilot Prompt: Chrome Extension MVP – Unit Converter
🎯 Goal

Build a Chrome Extension that converts currency, temperature, and time into a user’s preferred units, entirely locally (no API calls).

✅ Requirements
1. User Preferences

On first install, let the user select preferences via the extension popup:

Currency (default: INR).

Temperature (default: Celsius).

Time Zone (default: IST).

Store preferences using chrome.storage.sync.

2. Content Script – Detect & Convert

Inject content.js into web pages.

Detect text using regex patterns:

Currency: \b\d+(\.\d+)?\s?(USD|EUR|GBP|INR)\b

Temperature: \b\d+(\.\d+)?\s?(°F|°C|K)\b

Time: \b\d{1,2}:\d{2}\s?(AM|PM)?\s?(PST|EST|CET|IST)\b

On hover, display tooltip with converted value.

3. Conversion Logic (Hardcoded)

Currency (assume 1 USD = 83 INR, 1 EUR = 90 INR, 1 GBP = 100 INR for MVP).

Temperature

F → C: (F - 32) * 5/9

K → C: K - 273.15

Time Zones

Convert between fixed offsets (no DST for MVP).

Example: PST = UTC-8, IST = UTC+5:30.

4. Popup UI

Modern, sleek UI (basic Tailwind or plain CSS).

Two tabs:

Settings → dropdowns for preferences.

Preview → sample conversions (e.g., 100 USD → ₹8300).

5. Tooltip UI

When hovering detected text, show:

A small, rounded tooltip near cursor.

Smooth fade-in/out animation.

Auto-hide on mouse leave.

📂 File Structure
currency-time-temp-extension/
│── manifest.json
│── popup.html
│── popup.js
│── popup.css
│── content.js
│── tooltip.css
│── background.js (optional for routing, can skip for MVP)
│── sample-page.html (for testing)

🧪 Testing

Create sample-page.html with dummy values:

100 USD, 20 EUR, 72°F, 310K, 9:00 AM PST.

Load extension in Chrome (Developer Mode).

Hover over test values → confirm converted tooltip appears.

Change preferences in popup → ensure conversions reflect changes.

🚀 Next Steps for Copilot

Scaffold manifest.json (Manifest V3).

Implement popup.html with modern UI.

Add popup.js logic for storing preferences.

Write content.js for regex detection + hover listeners.

Build tooltip.css for a clean look.

Test on sample-page.html.