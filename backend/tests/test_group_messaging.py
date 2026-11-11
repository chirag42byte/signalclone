import asyncio
import os
import tempfile
import unittest

database_fd, database_path = tempfile.mkstemp(suffix=".db")
os.close(database_fd)
os.environ["DATABASE_URL"] = "sqlite:///" + database_path.replace("\\", "/")

from fastapi import HTTPException
from sqlalchemy import select

from app.database import Base, SessionLocal, engine
from app.main import (
    add_group_members,
    create_group_resource,
    delete_group_member,
    direct,
    get_group,
    get_group_messages,
    leave_group,
    send_group_message,
    send_message,
    update_group_role,
)
from app.models import ConversationMember, Message, User
from app.schemas import GroupCreateIn, GroupMembersIn, GroupRoleIn, MessageIn
from app.security import create_token
from app.realtime import manager


class FakeWebSocket:
    def __init__(self):
        self.payloads = []

    async def accept(self):
        pass

    async def send_text(self, payload):
        self.payloads.append(payload)


class GroupMessagingTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        engine.dispose()
        for suffix in ("", "-wal", "-shm"):
            path = database_path + suffix
            if os.path.exists(path):
                os.remove(path)

    def setUp(self):
        manager.connections.clear()
        manager.group_rooms.clear()
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        self.db = SessionLocal()
        self.alice = User(username="alice", password_hash="hash", display_name="Alice")
        self.bob = User(username="bob", password_hash="hash", display_name="Bob")
        self.charlie = User(username="charlie", password_hash="hash", display_name="Charlie")
        self.db.add_all([self.alice, self.bob, self.charlie])
        self.db.commit()
        self.db.refresh(self.alice)
        self.db.refresh(self.bob)
        self.db.refresh(self.charlie)
        self.alice_auth = f"Bearer {create_token(self.alice.id)}"
        self.bob_auth = f"Bearer {create_token(self.bob.id)}"
        self.charlie_auth = f"Bearer {create_token(self.charlie.id)}"
        self.group = asyncio.run(create_group_resource(
            GroupCreateIn(name="Test group", member_ids=[self.bob.id, self.bob.id]),
            self.alice_auth,
            self.db,
        ))

    def tearDown(self):
        self.db.close()
        manager.connections.clear()
        manager.group_rooms.clear()

    def test_group_creation_access_and_admin_operations(self):
        detail = get_group(self.group["id"], self.alice_auth, self.db)
        self.assertEqual(detail["created_by"], self.alice.id)
        self.assertEqual({member["id"] for member in detail["members"]}, {self.alice.id, self.bob.id})
        roles = {member["id"]: member["role"] for member in detail["members"]}
        self.assertEqual(roles[self.alice.id], "admin")
        self.assertEqual(roles[self.bob.id], "member")

        with self.assertRaises(HTTPException) as denied:
            get_group(self.group["id"], self.charlie_auth, self.db)
        self.assertEqual(denied.exception.status_code, 403)

        with self.assertRaises(HTTPException) as denied:
            asyncio.run(add_group_members(
                self.group["id"], GroupMembersIn(user_ids=[self.charlie.id]), self.bob_auth, self.db
            ))
        self.assertEqual(denied.exception.status_code, 403)

        asyncio.run(update_group_role(
            self.group["id"], self.bob.id, GroupRoleIn(role="admin"), self.alice_auth, self.db
        ))
        asyncio.run(add_group_members(
            self.group["id"], GroupMembersIn(user_ids=[self.charlie.id]), self.bob_auth, self.db
        ))
        self.assertEqual(
            self.db.scalar(select(ConversationMember.id).where(
                ConversationMember.conversation_id == self.group["id"],
                ConversationMember.user_id == self.charlie.id,
            )) is not None,
            True,
        )
        asyncio.run(delete_group_member(self.group["id"], self.charlie.id, self.bob_auth, self.db))

    def test_group_message_persistence_pagination_and_room_delivery(self):
        alice_socket = FakeWebSocket()
        bob_socket = FakeWebSocket()
        outsider_socket = FakeWebSocket()
        asyncio.run(manager.connect(self.alice.id, alice_socket))
        asyncio.run(manager.connect(self.bob.id, bob_socket))
        asyncio.run(manager.connect(self.charlie.id, outsider_socket))
        manager.join_group(self.alice.id, self.group["id"], alice_socket)
        manager.join_group(self.bob.id, self.group["id"], bob_socket)

        results = []
        for index in range(3):
            results.append(asyncio.run(send_group_message(
                self.group["id"],
                MessageIn(client_id=f"client-{index}", content=f"message {index}"),
                self.alice_auth,
                self.db,
            )))
        self.assertEqual(self.db.scalar(select(Message).where(Message.client_id == "client-0")).content, "message 0")
        self.assertEqual(len(bob_socket.payloads), 3)
        self.assertEqual(len(outsider_socket.payloads), 0)

        duplicate = asyncio.run(send_group_message(
            self.group["id"],
            MessageIn(client_id="client-2", content="message 2"),
            self.alice_auth,
            self.db,
        ))
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(len(bob_socket.payloads), 3)

        page = get_group_messages(self.group["id"], 2, None, self.bob_auth, self.db)
        self.assertEqual([message["content"] for message in page], ["message 1", "message 2"])
        older = get_group_messages(self.group["id"], 2, page[0]["id"], self.bob_auth, self.db)
        self.assertEqual([message["content"] for message in older], ["message 0"])
        self.assertEqual([result["id"] for result in results], sorted(result["id"] for result in results))

        with self.assertRaises(HTTPException) as denied:
            get_group_messages(self.group["id"], 10, None, self.charlie_auth, self.db)
        self.assertEqual(denied.exception.status_code, 403)

        asyncio.run(delete_group_member(self.group["id"], self.bob.id, self.alice_auth, self.db))
        after_removal = len(bob_socket.payloads)
        asyncio.run(send_group_message(
            self.group["id"],
            MessageIn(client_id="client-after-removal", content="private update"),
            self.alice_auth,
            self.db,
        ))
        self.assertEqual(len(bob_socket.payloads), after_removal)
        with self.assertRaises(HTTPException) as denied:
            get_group_messages(self.group["id"], 10, None, self.bob_auth, self.db)
        self.assertEqual(denied.exception.status_code, 403)

    def test_direct_message_flow_remains_available(self):
        conversation = direct(self.bob.id, self.alice_auth, self.db)
        payload = asyncio.run(send_message(
            conversation["id"],
            MessageIn(client_id="direct-1", content="hello"),
            self.alice_auth,
            self.db,
        ))
        self.assertEqual(payload["content"], "hello")
        self.assertEqual(payload["conversation_id"], conversation["id"])

    def test_group_member_can_leave(self):
        result = asyncio.run(leave_group(self.group["id"], self.bob_auth, self.db))
        self.assertTrue(result["ok"])
        with self.assertRaises(HTTPException) as denied:
            get_group(self.group["id"], self.bob_auth, self.db)
        self.assertEqual(denied.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
