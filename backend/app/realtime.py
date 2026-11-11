from collections import defaultdict
import logging
from fastapi import WebSocket, WebSocketDisconnect
import json

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        self.connections: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        self.connections[user_id].add(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket):
        self.connections[user_id].discard(websocket)
        if not self.connections[user_id]:
            self.connections.pop(user_id, None)

    async def send_user(self, user_id: int, payload: dict) -> bool:
        dead = []
        delivered = False
        for socket in list(self.connections.get(user_id, set())):
            try:
                await socket.send_text(json.dumps(payload, default=str))
                delivered = True
            except (OSError, RuntimeError, WebSocketDisconnect) as error:
                logger.debug("Removing disconnected websocket for user %s: %s", user_id, error)
                dead.append(socket)
        for socket in dead:
            self.disconnect(user_id, socket)
        return delivered

    async def broadcast(self, user_ids: list[int], payload: dict) -> dict[int, bool]:
        results = {}
        for uid in set(user_ids):
            results[uid] = await self.send_user(uid, payload)
        return results

manager = ConnectionManager()
