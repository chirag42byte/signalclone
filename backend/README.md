# Backend
Run with Python 3.11+.

```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python seed.py
uvicorn app.main:app --reload
```

API docs: http://localhost:8000/docs

Demo accounts: `alex`, `sam`, `jordan`, `taylor` — password `signal123`.

Group conversations use the existing `conversations`, `conversation_members`, `messages`, and `message_receipts` tables. On startup, the API creates missing tables and applies safe additive columns for group ownership, descriptions, avatars, and member read timestamps.

Authenticated group endpoints are available under the project's `/api` prefix:

- `POST /api/groups`, `GET /api/groups`, `GET /api/groups/{group_id}`, `PATCH /api/groups/{group_id}`
- `POST /api/groups/{group_id}/members`, `DELETE /api/groups/{group_id}/members/{user_id}`
- `POST /api/groups/{group_id}/leave`, `PATCH /api/groups/{group_id}/members/{user_id}/role`
- `GET /api/groups/{group_id}/messages?limit=50&before_id=...`, `POST /api/groups/{group_id}/messages`

The existing per-user websocket accepts authenticated `group.join` events after checking membership. Group messages are sent to active sockets subscribed to that group's room; persisted message history remains available to members who reconnect. Direct conversations continue to use the original conversation and message endpoints.
