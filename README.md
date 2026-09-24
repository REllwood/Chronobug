<div align="center">

# Chronobug

**Put a web application at the exact date, time zone and clock transition where it misbehaves.**

[![License: MIT](https://img.shields.io/badge/license-MIT-2f6f4e?style=flat-square)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-%3E%3D22-43853d?style=flat-square&logo=node.js&logoColor=white)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-555?style=flat-square)

</div>

Time bugs live in the hour that happens twice in autumn and the hour that never happens in spring. Chronobug gives your code an injected virtual clock, so you can stand on those exact moments, schedule timers and step across the boundary without touching your system clock.

## What it does

- Resolves a local wall time in a named time zone into zero, one or two real instants
- Makes you pick which instant you mean when daylight saving creates an overlap
- Schedules labelled timers and advances them deterministically
- Only ever moves time forwards while advancing; jumping the clock keeps each timer's remaining delay, like `setTimeout` across a system clock change
- Guards big jumps against runaway timer loops, and lets you cancel them
- Leaves the operating-system clock and the global `Date` alone

## Quick start

Requires Node.js 22 or newer. No `npm install` needed.

```sh
git clone https://github.com/REllwood/Chronobug.git
cd Chronobug
npm start
```

Open http://localhost:4175, activate one of the named transition scenarios, schedule a few timers and advance the clock.

## Status

v0.1 is the clock engine plus a browser lab to drive it. Next up are adapters that plug the clock into your app, server and database, and Playwright integration.

## Development

```sh
npm test        # clock, time zone and lab tests
npm run check   # tests plus syntax checks
```

The browser lab tests drive the real page in Chromium and run whenever Playwright is available; without it they're skipped. To include them:

```sh
npm install --no-save playwright
npx playwright install chromium
```

## License

[MIT](LICENSE)
