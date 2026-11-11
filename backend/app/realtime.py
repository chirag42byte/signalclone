from collections import defaultdict
import logging
from fastapi import WebSocket, WebSocketDisconnect
import json

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        self.connections: dict[int, set[WebSocket]] = defaultdict(set)
        self.group_rooms: dict[int, dict[int, set[WebSocket]]] = defaultdict(lambda: defaultdict(set))

    async def connect(self, user_id: int, websocket: WebSocket):
        await websocket.accept()
        self.connections[user_id].add(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket):
        self.connections[user_id].discard(websocket)
        if not self.connections[user_id]:
            self.connections.pop(user_id, None)
        for group_id, members in list(self.group_rooms.items()):
            sockets = members.get(user_id)
            if sockets:
                sockets.discard(websocket)
                if not sockets:
                    members.pop(user_id, None)
            if not members:
                self.group_rooms.pop(group_id, None)

    def join_group(self, user_id: int, group_id: int, websocket: WebSocket):
        if websocket in self.connections.get(user_id, set()):
            self.group_rooms[group_id][user_id].add(websocket)

    def join_group_user(self, user_id: int, group_id: int):
        for websocket in self.connections.get(user_id, set()):
            self.join_group(user_id, group_id, websocket)

    def leave_group(self, user_id: int, group_id: int):
        members = self.group_rooms.get(group_id)
        if not members:
            return
        members.pop(user_id, None)
        if not members:
            self.group_rooms.pop(group_id, None)

    async def broadcast_group(self, group_id: int, payload: dict) -> dict[int, bool]:
        results = {}
        for user_id, sockets in list(self.group_rooms.get(group_id, {}).items()):
            delivered = False
            dead = []
            for socket in list(sockets):
                try:
                    await socket.send_text(json.dumps(payload, default=str))
                    delivered = True
                except (OSError, RuntimeError, WebSocketDisconnect) as error:
                    logger.debug("Removing disconnected group websocket for user %s: %s", user_id, error)
                    dead.append(socket)
            for socket in dead:
                self.disconnect(user_id, socket)
            results[user_id] = delivered
        return results

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
