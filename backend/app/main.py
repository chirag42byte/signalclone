import os
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import select, desc
from datetime import datetime, timezone
from .database import Base, engine, get_db, SessionLocal
from .models import User, Contact, Conversation, ConversationMember, Message, MessageReceipt
from .schemas import RegisterIn, LoginIn, ContactIn, GroupIn, MessageIn, ReceiptIn
from .security import hash_password, verify_password, create_token, decode_token
from .realtime import manager

Base.metadata.create_all(bind=engine)
app = FastAPI(title="Signal Clone API", version="1.0.0")
allowed_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    if origin.strip()
]
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

def current_user(authorization: str | None, db: Session) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authentication required")
    try:
        uid = decode_token(authorization.split(" ", 1)[1])
    except Exception:
        raise HTTPException(401, "Invalid or expired session")
    user = db.get(User, uid)
    if not user:
        raise HTTPException(401, "User not found")
    return user

def member_ids(db: Session, conversation_id: int):
    return [m.user_id for m in db.scalars(select(ConversationMember).where(ConversationMember.conversation_id == conversation_id)).all()]

def user_payload(u: User):
    return {"id": u.id, "username": u.username, "display_name": u.display_name, "phone": u.phone, "avatar_url": u.avatar_url, "is_online": u.is_online}

def message_status(db: Session, message: Message) -> str:
    receipts = db.scalars(select(MessageReceipt).where(MessageReceipt.message_id == message.id)).all()
    if not receipts:
        return "sent"
    if all(receipt.status == "read" for receipt in receipts):
        return "read"
    if all(receipt.status in ("delivered", "read") for receipt in receipts):
        return "delivered"
    return "sent"

async def broadcast_message(db: Session, message: Message, user_ids: list[int]) -> dict:
    payload = {"id": message.id, "client_id": message.client_id, "conversation_id": message.conversation_id, "sender_id": message.sender_id, "content": message.content, "created_at": message.created_at, "status": "sent"}
    await manager.broadcast(user_ids, {"type": "message.new", "message": payload})
    payload["status"] = message_status(db, message)
    if payload["status"] != "sent":
        await manager.send_user(message.sender_id, {"type": "receipt.update", "message_id": message.id, "status": payload["status"]})
    return payload

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/api/auth/register")
def register(data: RegisterIn, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.username == data.username)):
        raise HTTPException(409, "Username already exists")
    user = User(username=data.username, password_hash=hash_password(data.password), display_name=data.display_name, phone=data.phone)
    db.add(user); db.commit(); db.refresh(user)
    return {"token": create_token(user.id), "user": user_payload(user)}

@app.post("/api/auth/login")
def login(data: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == data.username))
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Incorrect username or password")
    user.is_online = True; db.commit()
    return {"token": create_token(user.id), "user": user_payload(user)}

@app.get("/api/me")
def me(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    return user_payload(current_user(authorization, db))

@app.post("/api/auth/logout")
def logout(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    user = current_user(authorization, db); user.is_online = False; user.last_seen = datetime.now(timezone.utc); db.commit()
    return {"ok": True}

@app.get("/api/users")
def search_users(q: str = "", authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    users = db.scalars(select(User).where(User.id != me.id, User.username.contains(q) | User.display_name.contains(q)).limit(30)).all()
    return [user_payload(u) for u in users]

@app.post("/api/contacts")
def add_contact(data: ContactIn, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    other = db.scalar(select(User).where(User.username == data.username))
    if not other or other.id == me.id: raise HTTPException(404, "User not found")
    existing = db.scalar(select(Contact).where(Contact.owner_id == me.id, Contact.contact_user_id == other.id))
    if not existing: db.add(Contact(owner_id=me.id, contact_user_id=other.id, nickname=data.nickname)); db.commit()
    return user_payload(other)

@app.get("/api/contacts")
def contacts(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    rows = db.scalars(select(Contact).where(Contact.owner_id == me.id)).all()
    return [{"id": r.id, "nickname": r.nickname, "user": user_payload(db.get(User, r.contact_user_id))} for r in rows]

@app.post("/api/conversations/direct/{other_id}")
def direct(other_id: int, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    if not db.get(User, other_id): raise HTTPException(404, "User not found")
    for c in db.scalars(select(Conversation).where(Conversation.type == "direct")).all():
        ids = set(member_ids(db, c.id))
        if ids == {me.id, other_id}: return {"id": c.id}
    c = Conversation(type="direct")
    db.add(c); db.flush()
    db.add_all([ConversationMember(conversation_id=c.id, user_id=me.id, role="admin"), ConversationMember(conversation_id=c.id, user_id=other_id, role="member")])
    db.commit()
    return {"id": c.id}

@app.post("/api/conversations/group")
def create_group(data: GroupIn, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    c = Conversation(type="group", title=data.title)
    db.add(c); db.flush()
    ids = set(data.member_ids + [me.id])
    for uid in ids:
        if db.get(User, uid): db.add(ConversationMember(conversation_id=c.id, user_id=uid, role="admin" if uid == me.id else "member"))
    db.commit()
    return {"id": c.id, "title": c.title}

@app.get("/api/conversations")
def conversations(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    memberships = db.scalars(select(ConversationMember).where(ConversationMember.user_id == me.id)).all()
    result = []
    for membership in memberships:
        c = db.get(Conversation, membership.conversation_id)
        ids = member_ids(db, c.id)
        last = db.scalar(select(Message).where(Message.conversation_id == c.id).order_by(desc(Message.created_at)).limit(1))
        others = [db.get(User, uid) for uid in ids if uid != me.id]
        title = c.title or (others[0].display_name if others else "Conversation")
        result.append({"id": c.id, "type": c.type, "title": title, "members": [user_payload(db.get(User, uid)) for uid in ids], "last_message": ({"content": last.content, "created_at": last.created_at, "sender_id": last.sender_id} if last else None), "updated_at": c.updated_at})
    return sorted(result, key=lambda x: str(x["last_message"]["created_at"] if x["last_message"] else x["updated_at"]), reverse=True)

@app.get("/api/conversations/{conversation_id}/messages")
def get_messages(conversation_id: int, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    ids = member_ids(db, conversation_id)
    if me.id not in ids: raise HTTPException(403, "Not a conversation member")
    rows = db.scalars(select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)).all()
    backfilled = False
    for message in rows:
        recipients = [uid for uid in ids if uid != message.sender_id]
        existing = db.scalars(select(MessageReceipt).where(MessageReceipt.message_id == message.id)).all()
        existing_users = {receipt.user_id for receipt in existing}
        for uid in recipients:
            if uid not in existing_users:
                db.add(MessageReceipt(message_id=message.id, user_id=uid, status="sent"))
                backfilled = True
    if backfilled:
        db.commit()
    result = []
    for message in rows:
        receipt = db.scalar(select(MessageReceipt).where(MessageReceipt.message_id == message.id, MessageReceipt.user_id == me.id))
        status = message_status(db, message) if message.sender_id == me.id else receipt.status if receipt else None
        result.append({"id": message.id, "client_id": message.client_id, "conversation_id": message.conversation_id, "sender_id": message.sender_id, "content": message.content, "reply_to_id": message.reply_to_id, "created_at": message.created_at, "status": status})
    return result

@app.post("/api/conversations/{conversation_id}/messages")
async def send_message(conversation_id: int, data: MessageIn, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    ids = member_ids(db, conversation_id)
    if me.id not in ids: raise HTTPException(403, "Not a conversation member")
    existing = db.scalar(select(Message).where(Message.client_id == data.client_id))
    if existing:
        if existing.sender_id != me.id or existing.conversation_id != conversation_id:
            raise HTTPException(409, "Client message ID is already in use")
        payload = await broadcast_message(db, existing, ids)
        payload["duplicate"] = True
        return payload
    msg = Message(client_id=data.client_id, conversation_id=conversation_id, sender_id=me.id, content=data.content, reply_to_id=data.reply_to_id)
    db.add(msg)
    c = db.get(Conversation, conversation_id); c.updated_at = datetime.now(timezone.utc)
    db.flush()
    for uid in ids:
        if uid != me.id: db.add(MessageReceipt(message_id=msg.id, user_id=uid, status="sent"))
    db.commit(); db.refresh(msg)
    return await broadcast_message(db, msg, ids)

@app.post("/api/messages/{message_id}/receipt")
async def receipt(message_id: int, data: ReceiptIn, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    msg = db.get(Message, message_id)
    if not msg: raise HTTPException(404, "Message not found")
    if me.id not in member_ids(db, msg.conversation_id): raise HTTPException(403, "Not a member")
    row = db.scalar(select(MessageReceipt).where(MessageReceipt.message_id == message_id, MessageReceipt.user_id == me.id))
    if me.id == msg.sender_id: raise HTTPException(403, "Only message recipients can update receipts")
    if not row:
        row = MessageReceipt(message_id=message_id, user_id=me.id, status=data.status)
        db.add(row)
        db.commit()
    if row.status != "read" and row.status != data.status:
        row.status = data.status
        row.updated_at = datetime.now(timezone.utc)
        db.commit()
    status = message_status(db, msg)
    await manager.send_user(msg.sender_id, {"type": "receipt.update", "message_id": message_id, "user_id": me.id, "status": status})
    return {"ok": True, "status": status}

async def deliver_pending_messages(user_id: int):
    db = SessionLocal()
    try:
        pending = db.scalars(select(MessageReceipt).where(MessageReceipt.user_id == user_id, MessageReceipt.status == "sent").order_by(MessageReceipt.id)).all()
        for row in pending:
            msg = db.get(Message, row.message_id)
            if not msg:
                continue
            payload = {"type": "message.new", "message": {"id": msg.id, "client_id": msg.client_id, "conversation_id": msg.conversation_id, "sender_id": msg.sender_id, "content": msg.content, "created_at": msg.created_at, "status": "sent"}}
            await manager.send_user(user_id, payload)
    finally:
        db.close()

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: int, token: str):
    try:
        if decode_token(token) != user_id:
            await websocket.close(code=1008); return
    except Exception:
        await websocket.close(code=1008); return
    await manager.connect(user_id, websocket)
    try:
        await deliver_pending_messages(user_id)
        while True:
            event = await websocket.receive_json()
            if event.get("type") in ("typing.start", "typing.stop"):
                db = SessionLocal()
                try:
                    ids = member_ids(db, int(event["conversation_id"]))
                    await manager.broadcast([uid for uid in ids if uid != user_id], {**event, "user_id": user_id})
                finally: db.close()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(user_id, websocket)