# CampingScout

> Find your kind of wild.

CampingScout is an evidence-aware AI camping planner built for OpenAI Build Week. It turns a departure point, dates, party, budget, gear, and “wild vs. convenient / quiet vs. popular” preferences into ranked campground choices, route-aware trip plans, and explicit equipment warnings.

![CampingScout social preview](public/og.png)

## Why it matters

Camping search is fragmented across campground directories, weather pages, maps, operator sites, and gear checklists. CampingScout combines those inputs but keeps their provenance visible: public-data facts, live forecasts, routing results, and AI recommendations are labeled separately. It never presents AI inference as live availability or official safety advice.

## Product capabilities

- Live Korea Tourism Organization GoCamping search with a curated fallback
- Mapbox Directions and Isochrone routing with an honest estimated fallback
- Open-Meteo weather and sleeping-bag comfort mismatch warnings
- DeepSeek V4 Flash through OpenRouter for structured trip and packing recommendations
- Temporary in-app OpenRouter key connection stored only in browser session storage
- Sign in with ChatGPT on OpenAI Sites
- Cloudflare D1 profile and saved-trip persistence
- Public, unguessable trip share links
- Real operator/booking links when the public record provides one
- Responsive desktop and mobile interface with keyboard focus states
- Source, live/fallback, and policy-verification labels throughout

## Architecture

```text
Browser (Next/Vinext UI + MapLibre)
  ├─ /api/campgrounds  → KTO GoCamping public data
  ├─ /api/navigation   → Mapbox Directions + Isochrone
  ├─ /api/weather      → Open-Meteo
  ├─ /api/plan         → OpenRouter (DeepSeek V4 Flash)
  ├─ /api/openrouter/test → real provider connection test
  ├─ /api/profile      → Sign in with ChatGPT + D1
  └─ /api/trips        → Sign in with ChatGPT + D1 + share route
```

The app runs on Cloudflare Workers through Vinext and OpenAI Sites. Secrets stay server-side; no private API key is shipped to the browser.

## Environment variables

Copy `.env.example` to `.env.local` for local development, or set these in the deployment environment:

| Variable | Required for live mode | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | Optional | Server-wide OpenRouter key; users may instead connect a temporary key in the UI |
| `OPENROUTER_MODEL` | No | Defaults to `deepseek/deepseek-v4-flash` |
| `GOCAMPING_SERVICE_KEY` | Yes | data.go.kr GoCamping service key |
| `MAPBOX_ACCESS_TOKEN` | Yes | Server-side Directions/Isochrone requests |
| `NEXT_PUBLIC_MAP_STYLE_URL` | No | Optional MapLibre-compatible map style |
| `NEXT_PUBLIC_SITE_URL` | Production | Canonical URL and shared-page server fetches |

`OPENROUTER_API_KEY`, `GOCAMPING_SERVICE_KEY`, and `MAPBOX_ACCESS_TOKEN` must be stored as deployment secrets. Never prefix them with `NEXT_PUBLIC_`. A key entered in the app is sent only to the same-origin server route and retained only in that tab's `sessionStorage` after a successful live test.

## Local development

```bash
npm install
npm run dev
```

Quality gates:

```bash
npm run typecheck
npm run lint
npm run build
npm audit --omit=dev
```

## Live vs. fallback behavior

The repository works without private keys for judgeability. Every integration returns a labeled deterministic fallback when its key/provider is unavailable. A live deployment becomes fully connected by setting environment variables—no code changes are required.

- AI fallback never claims to be a live DeepSeek response.
- GoCamping fallback is labeled as demo/curated data.
- Routing fallback is labeled estimated and does not invent an isochrone.
- Weather falls back to the campground snapshot and is labeled non-live.
- Saving requires an authenticated user and never silently creates an anonymous cloud record.

## Security and responsible use

- Provider keys are read only inside server routes.
- Database records are scoped to the authenticated email header supplied by the hosting platform.
- Share tokens are random 80-bit URL tokens and reveal only the selected trip payload.
- Inputs are type/range checked before provider calls; external links use `rel="noreferrer"`.
- DeepSeek receives supplied trip facts and is instructed not to invent policies, availability, weather, prices, routes, or safety claims.
- Users are repeatedly asked to verify operator policies, official alerts, and availability.

This is a planning assistant, not an emergency, weather-warning, or reservation service.

## Hackathon demo flow

1. Edit departure city, dates, travelers, budget, and drive radius.
2. Move the “Tune your wild” point and compare the ranked recommendations.
3. Select a campground and inspect the route, source, weather, and gear warning.
4. Ask Scout: “Make it quieter, dog-friendly, and safe for my 8°C sleeping bag.”
5. Open the operator link, save the trip, and share the copied link.

## License

MIT — see [LICENSE](LICENSE).
