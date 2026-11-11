<<<<<<< HEAD
# Signal_clone
=======
# Signal-style Messenger (educational clone)

A desktop-first messaging application inspired by Signal. This is an original implementation for a software project; it is not affiliated with Signal Messenger.

## Features in this starter
- Username/password registration and login with JWT session persistence
- Seeded demo users and conversations
- Direct conversations and group conversation data model
- Persistent messages in SQLite
- WebSocket delivery of new messages and typing events, with undelivered-message replay after reconnect
- Per-recipient sent, delivered, and read message states
- Idempotent message submission using client-generated IDs
- Message timestamps, optimistic sending, online status field
- Search users and conversations
- Responsive desktop/mobile layout and settings placeholders

## Stack
- Next.js 15, React 19, TypeScript, Tailwind CSS
- FastAPI, SQLAlchemy, SQLite
- WebSockets, JWT, bcrypt

## Run locally

### Backend
```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python seed.py
uvicorn app.main:app --reload
```
API docs: http://localhost:8000/docs

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:3000.

### Demo accounts
- alex / signal123
- sam / signal123
- jordan / signal123
- taylor / signal123

## Environment variables
Optional frontend variables:
- `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`)
- `NEXT_PUBLIC_WS_URL` (default `ws://localhost:8000`)

## Architecture
The browser uses REST for authentication, user search, conversation loading, durable message writes, and read receipts. A WebSocket connection per authenticated user carries live message events and typing indicators; the client reconnects with backoff, acknowledges received messages, and syncs the selected conversation. The backend persists each message and per-recipient receipt state in SQLite, replays messages that were not acknowledged while a recipient was offline, and broadcasts receipt updates. Opening a conversation marks its incoming messages as read.

## Database schema
- `users`: identity and password hash
- `contacts`: directed contact relationships and optional nickname
- `conversations`: direct/group conversation metadata
- `conversation_members`: membership and role
- `messages`: durable message history and client idempotency key
- `message_receipts`: per-recipient sent/delivered/read state
- `reactions`: message reactions

Foreign keys express the relationships; unique constraints prevent duplicate memberships, contacts, receipts, and client message IDs.

## API overview
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/users?q=...`
- `GET /api/contacts`, `POST /api/contacts`
- `GET /api/conversations`
- `POST /api/conversations/direct/{user_id}`
- `POST /api/conversations/group`
- `GET /api/conversations/{id}/messages`
- `POST /api/conversations/{id}/messages`
- `POST /api/messages/{id}/receipt`
- `WS /ws/{user_id}?token=...`

## Important limitations / assumptions
- This is a functional educational prototype, not production Signal.
- End-to-end encryption, real phone/SMS verification, push notifications, file uploads, full group administration UI, and production-grade presence are not implemented yet.
- The UI is Signal-inspired and uses original CSS/components; it does not use Signal's proprietary assets.
- Production requires a secret `SECRET_KEY`, a persistent PostgreSQL `DATABASE_URL`, and your frontend origin in `CORS_ORIGINS`.
- For production, add rate limiting, database migrations, refresh-token rotation, authorization tests, and shared pub/sub before running multiple API instances.

## Deploying
The repository includes a Render Blueprint in [`render.yaml`](./render.yaml) for a single-instance FastAPI service. To deploy:

1. Push the repository to GitHub.
2. In Render, create a **PostgreSQL** database in the **Oregon** region. Choose a persistent paid plan for any real users; Render's free database expires. Copy its **internal** connection URL.
3. In Render, create a Blueprint from the repository. The Blueprint creates the API with a generated `SECRET_KEY`; it prompts for `DATABASE_URL` and `CORS_ORIGINS`. Set `DATABASE_URL` to the PostgreSQL internal URL. The SQLAlchemy setup accepts Render's `postgres://`/`postgresql://` URL schemes and uses psycopg 3.
4. Create a Vercel project from the same GitHub repository and set its **Root Directory** to `frontend`. Add these Production environment variables, substituting the Render service hostname and Vercel domain:
   - `NEXT_PUBLIC_API_URL`: `https://<render-service>.onrender.com`
   - `NEXT_PUBLIC_WS_URL`: `wss://<render-service>.onrender.com`
5. Set Render's `CORS_ORIGINS` to the exact Vercel origin, for example `https://<your-app>.vercel.app` (no path or trailing slash). Include any custom domain as another comma-separated origin. Redeploy both services after changing environment variables.
6. Open the Vercel URL, register a new account, and test messaging and WebSocket reconnects. Tables are created at API startup. **Do not run `backend/seed.py` on a public production service**: it creates accounts with the published demo password.

The Render Blueprint uses a free API instance for evaluation; it may sleep when idle. Use an always-on plan for a responsive app. Keep the API at one instance: the current WebSocket manager is in-memory, so multiple instances need Redis/pub-sub to deliver messages between clients on different instances. Use PostgreSQL rather than SQLite because a deployed service's local filesystem is not a suitable persistent database.

Vercel includes `NEXT_PUBLIC_*` values in the frontend build, so add them before deploying or redeploy after changes. Never put the database URL or JWT secret in Vercel's public frontend variables.
>>>>>>> b5aaa40 (Prepare Signal clone for deployment)
