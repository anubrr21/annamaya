# Annamaya

A mess menu and calorie journal for hostel students. It reads the monthly mess menu from the Excel sheet the college circulates, shows what is being served right now, and keeps a record of what you actually ate.

The name comes from *annamaya kosha*, the body made of food.

## Features

**Menu**
- Reads the monthly menu workbook directly (`.xlsx`), including the Veg / Non-Veg and Special sheets
- Shows the current meal based on the time of day and rolls over to the next one automatically
- Handles date-specific dishes and splits combined cells into individual items
- Import a new workbook each month from inside the app

**Logging**
- Photograph a plate for a calorie and macro estimate, using your own API keys
- Up to four AI services (Gemini, Groq, OpenRouter, Mistral) with automatic fallback when one fails
- Tick items off the day's menu, with portion steppers
- Add anything by hand
- Photos taken offline are queued and analysed when the device is back online

**Analysis**
- Daily coupon view with calories against target and a timeline of the day
- Day statement: meal-by-meal breakdown, macro split, food groups, itemised list, eating window and notes
- Journal in the form of a monthly attendance register
- Insights over 7 days, 30 days, the month or all time: attendance, weekday pattern, most eaten dishes
- Export a full PDF report or CSV for any period

**Other**
- Works fully offline; all data stays on the device
- Light and dark themes
- Backup and restore

## Running it

### Web

Serve the folder with any static server:

```bash
python -m http.server 5173
```

Then open `http://localhost:5173`. On Windows, `start.bat` does the same thing. The app is an installable PWA, so once hosted over HTTPS it can be added to a phone's home screen.

### Android

The Android app is a thin shell around the same code, with the web files bundled as assets.

```bash
python tools/build-apk.py
```

This needs the Android SDK (build-tools and a platform) and a JDK. It produces `Annamaya.apk`, signed with a local key that is generated on the first build. Minimum Android version is 10.

## Photo estimates

Add a key for any of the supported services under **Settings → Photo calorie estimates**: Gemini, Groq, OpenRouter or Mistral. Each can be tested from the same screen. When more than one key is saved, the app tries them in order and moves to the next if a request fails or a quota runs out. Keys are stored on the device and sent only to their own service. Without a key, menu and manual logging still work using the built-in food table.

All calorie and nutrient figures are estimates.

## Using a different menu

Go to **Menu → Import menu Excel**. The workbook should have a `Day` column with the weekday and dates (for example `Thu 1, 15, 29`) and `Breakfast`, `Lunch`, `Snacks` and `Dinner` columns. The year is read from the file name. Meal timings can be changed in Settings.

## Project structure

```
index.html            App shell
css/app.css           Styles
js/
  app.js              Views, routing, settings
  log.js              Logging sheets
  menu.js             Menu parsing and meal schedule
  xlsx.js             Workbook reader
  nutrition.js        Food table, targets, food groups
  insights.js         Period and day analysis
  charts.js           SVG charts and icons
  ai.js               AI service requests and fallback
  pdf.js, report.js   PDF report
  db.js               IndexedDB storage
  fx.js               Small UI effects
sw.js                 Offline cache
android/              Android shell
menu/                 Bundled menu workbook
tools/                Build and check scripts
```

## Tech

Plain HTML, CSS and JavaScript with no framework and no build step. Storage is IndexedDB. The workbook reader and PDF writer are written from scratch, so the app has no runtime dependencies.
