# Deploy Publicly (No Local Run)

## Fastest: Render (Free tier available)
1. Push this folder to a GitHub repo.
2. Go to [https://render.com](https://render.com) and sign in.
3. Click `New +` -> `Blueprint`.
4. Connect the GitHub repo.
5. Render will detect `render.yaml` and create the web service.
6. Once build completes, open the generated URL (example: `https://stop-10-multiplayer.onrender.com`).

## Alternate: Railway
1. Push code to GitHub.
2. Go to [https://railway.app](https://railway.app) -> `New Project` -> `Deploy from GitHub repo`.
3. Select this repo.
4. Railway will run `npm start` automatically.
5. Open the generated domain from project settings.

## Notes
- The app reads `PORT` from environment, so cloud platforms will bind correctly.
- Multiplayer rooms are in-memory; restarting the server clears active rooms/scores.
