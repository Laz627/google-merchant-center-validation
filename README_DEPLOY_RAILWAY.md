# Google Merchant Center Product Feed Validator – Railway Deploy

## Quick Deploy
1) Create a new Railway project -> **Deploy from GitHub** (or **Upload** this folder).
2) Ensure the repo **root** contains: `app/`, `static/`, `requirements.txt`, `Procfile`, `start.sh`.
3) Railway will detect Python from `requirements.txt` and the `Procfile` will launch the app.

### Service settings
- Service Type: `Web` (auto)
- Start Command (if asked): `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Expose Port: `$PORT` (auto)

### Health
- HTTP path: `/`

If you see "Railpack could not determine how to build the app", your project root likely contains a **single subfolder**. Move all files to the repo root.
