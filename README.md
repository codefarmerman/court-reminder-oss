# Court Reminder

Court Reminder is a mobile-first Next.js app for turning a court summons image into a calendar event. It extracts structured hearing details with a vision model, lets the user review and edit the result, and writes the event to an iCloud calendar through CalDAV with multiple reminders.

## Features

- PIN-gated upload flow with basic rate limiting
- Client-side image compression before upload
- Vision-model extraction of court, case, party, hearing time, staff, phone, and notes fields
- Review screen for correcting extracted fields before calendar creation
- iCalendar VEVENT generation with Asia/Shanghai timezone handling
- iCloud CalDAV integration through `tsdav`
- PWA metadata and generated app icons for mobile installation
- Security headers and defensive input validation

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- OpenAI-compatible SDK for Moonshot/Kimi Vision
- tsdav for CalDAV

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your own values:

```bash
cp .env.example .env.local
```

Required variables:

- `MOONSHOT_API_KEY`: Moonshot API key for vision extraction
- `ICLOUD_USERNAME`: iCloud account email used for CalDAV
- `ICLOUD_APP_PASSWORD`: Apple app-specific password, not the account password
- `ACCESS_PIN`: PIN required by the web app

Optional variable:

- `NEXT_PUBLIC_SITE_URL`: canonical site URL used by metadata

Never commit real credentials. Rotate any key or app-specific password that may have been shared outside a private secrets manager.

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in a browser.

## Build

```bash
npm run build
npm run start
```

## Security Notes

This project handles sensitive legal-document images and calendar data. Before running it in production, review the data flow, configure provider credentials in your deployment platform's secret store, limit access to trusted users, and avoid logging user-uploaded documents or extracted case details.

## Maintainer

Maintained by `codefarmerman`.
