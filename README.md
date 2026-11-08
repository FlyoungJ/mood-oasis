# Mood Oasis

Mood Oasis is a lightweight wellbeing web app created as a university software engineering team project. It supports private mood check-ins, a mood history view, community suggestions, and shared mood moments.

## Implemented features

- Account registration and login with bcrypt password hashing and JWT authentication
- Private mood check-ins with optional image attachments
- Calendar and chart-based mood history
- Community suggestions with like/dislike moderation
- Shared mood moments with anonymous display, likes, and comments
- Responsive desktop and mobile layouts

Friend relationships and AI-generated analysis are not implemented in this version. The mood chart and suggestions are deterministic application features, not AI output.

## Team

The project was created by:

- Feiyang Jiang
- Zelin Deng
- Wenyue Zong
- Ruizhe Tan
- Letong Yang
- Ruiyang Sun

## Requirements

- Node.js 20.6 or later
- npm

## Setup

1. Install the locked dependencies:

   ```sh
   npm ci
   ```

2. Copy `.env.example` to `.env` and replace `JWT_SECRET` with a unique random value containing at least 32 characters.

3. Start the app:

   ```sh
   npm run dev
   ```

4. Open <http://localhost:3000>.

The app stores data in local JSON files under `data/`. Runtime JSON files are ignored by Git and are created automatically when missing. Set `DATA_DIR` to use another directory, such as an isolated test or demo dataset.

## Tests

Run the API regression suite with:

```sh
npm test
```

The tests create their own temporary data directory and do not modify `data/`.

## Security notes

- Never commit `.env` or publish a real JWT secret.
- Runtime files under `data/` are intentionally excluded from version control.
- API responses intentionally omit internal user IDs and voting-user arrays.
- Anonymous posts keep ownership information only in server-side storage.
- Uploaded images are restricted to PNG, JPEG, GIF, and WebP data URLs.

## Technology

- Node.js and Express
- bcryptjs and JSON Web Tokens
- Vanilla HTML, CSS, and JavaScript
- Chart.js

## License

No open-source license is granted. This repository is published for portfolio and review purposes. Copyright remains with the respective project contributors.
