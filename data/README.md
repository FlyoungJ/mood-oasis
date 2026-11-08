# Runtime data

Mood Oasis creates the following local JSON files in this directory when the server starts:

- `users.json`
- `notes.json`
- `suggestions.json`
- `posts.json`

These files are intentionally ignored by Git. They can contain account hashes, mood entries, community content, and Base64-encoded images, and they can grow quickly during demonstrations.

To start with a clean dataset, stop the server and remove the JSON files. The next start recreates empty arrays. Set `DATA_DIR` to keep separate development, test, and demonstration datasets.
