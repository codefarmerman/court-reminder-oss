# Development History

This document keeps a public-safe summary of Court Reminder's evolution. Private deployment details, account identifiers, local machine paths, dashboard URLs, DNS records, and real credentials have been removed.

## Project Goal

Court Reminder is a personal productivity tool for converting a court summons image into a reviewed iCloud calendar event. The app focuses on reducing manual calendar entry, preserving hearing details in the event notes, and providing multiple reminders before the hearing time.

## Major Milestones

1. Built a Next.js mobile web app with a PIN-gated flow.
2. Added image upload, client-side compression, and progress feedback.
3. Integrated a vision model through an OpenAI-compatible SDK to extract structured summons data.
4. Added editable review fields before calendar creation.
5. Implemented CalDAV event creation with iCalendar VEVENT output.
6. Added Asia/Shanghai timezone handling and multiple VALARM reminders.
7. Hardened input validation, API error handling, and security headers.
8. Added PWA metadata and generated app icons for a mobile install experience.

## Architecture

```text
Browser/PWA
  -> Next.js API route: parse summons
  -> Vision model API
  -> User review screen
  -> Next.js API route: create reminder
  -> CalDAV calendar event
```

## Environment Variables

The application expects credentials to be supplied by environment variables only. See `.env.example` for placeholder names.

Required variables:

- `MOONSHOT_API_KEY`
- `ICLOUD_USERNAME`
- `ICLOUD_APP_PASSWORD`
- `ACCESS_PIN`

Optional variable:

- `NEXT_PUBLIC_SITE_URL`

Do not commit real `.env` files, provider credentials, Apple app-specific passwords, API keys, deployment dashboard URLs, or local machine paths.

## Security Work Completed

- PIN comparison uses timing-safe comparison.
- API routes apply basic rate limiting.
- Upload endpoints validate MIME type and size.
- Base64 payloads are checked before model submission.
- iCalendar text is escaped before event creation.
- User-facing errors avoid exposing provider exceptions.
- Calendar credentials are read only from environment variables.
- Security headers are configured in `next.config.ts`.

## Public Release Cleanup

Before making the repository public, the following cleanup was performed:

- Replaced default README with project documentation.
- Added `.env.example` with placeholders only.
- Updated `.gitignore` so real env files remain ignored while `.env.example` is tracked.
- Removed private deployment URLs, account-specific dashboard links, DNS details, local filesystem paths, and provider account notes from this history file.

## Future Work

- Add tests for parsing validation and calendar generation.
- Add an optional `.ics` export fallback.
- Support more calendar providers.
- Add a privacy-focused deployment guide.
- Add configurable reminder intervals.

## Maintainer

Maintained by `codefarmerman`.
