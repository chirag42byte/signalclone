import os
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import select, desc, delete, func, and_, or_
from datetime import datetime, timezone
from .database import initialize_database, get_db, SessionLocal
from .models import User, Contact, Conversation, ConversationMember, Message, MessageReceipt
from .schemas import (
    RegisterIn, LoginIn, ContactIn, GroupIn, GroupCreateIn, GroupUpdateIn,
    GroupMembersIn, GroupRoleIn, MessageIn, ReceiptIn,
)
from .security import hash_password, verify_password, create_token, decode_token
from .realtime import manager

initialize_database()
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

def require_group(db: Session, group_id: int) -> Conversation:
    group = db.get(Conversation, group_id)
    if not group or group.type != "group":
        raise HTTPException(404, "Group not found")
    return group

def require_group_member(db: Session, group: Conversation, user_id: int) -> ConversationMember:
    membership = db.scalar(select(ConversationMember).where(
        ConversationMember.conversation_id == group.id,
        ConversationMember.user_id == user_id,
    ))
    if not membership:
        raise HTTPException(403, "Not a group member")
    return membership

def require_group_admin(db: Session, group: Conversation, user_id: int) -> ConversationMember:
    membership = require_group_member(db, group, user_id)
    if membership.role != "admin":
        raise HTTPException(403, "Group admin permission required")
    return membership

def group_members_payload(db: Session, group_id: int):
    memberships = db.scalars(select(ConversationMember).where(
        ConversationMember.conversation_id == group_id
    ).order_by(ConversationMember.joined_at, ConversationMember.id)).all()
    result = []
    for membership in memberships:
        user = db.get(User, membership.user_id)
        if user:
            result.append({
                **user_payload(user),
                "role": membership.role,
                "joined_at": membership.joined_at,
                "last_read_at": membership.last_read_at,
            })
    return result

def conversation_payload(db: Session, conversation: Conversation, user_id: int):
    ids = member_ids(db, conversation.id)
    last = db.scalar(select(Message).where(
        Message.conversation_id == conversation.id
    ).order_by(desc(Message.created_at), desc(Message.id)).limit(1))
    others = [db.get(User, uid) for uid in ids if uid != user_id]
    title = conversation.title or (others[0].display_name if others else "Conversation")
    unread_count = db.scalar(
        select(func.count(MessageReceipt.id))
        .join(Message, MessageReceipt.message_id == Message.id)
        .where(
            Message.conversation_id == conversation.id,
            MessageReceipt.user_id == user_id,
            MessageReceipt.status != "read",
            Message.sender_id != user_id,
        )
    ) or 0
    return {
        "id": conversation.id,
        "type": conversation.type,
        "title": title,
        "created_by": conversation.created_by,
        "description": conversation.description,
        "avatar_url": conversation.avatar_url,
        "members": [user_payload(db.get(User, uid)) for uid in ids if db.get(User, uid)],
        "member_roles": {str(member["id"]): member["role"] for member in group_members_payload(db, conversation.id)} if conversation.type == "group" else {},
        "last_message": (
            {"content": last.content, "created_at": last.created_at, "sender_id": last.sender_id}
            if last else None
        ),
        "unread_count": unread_count,
        "updated_at": conversation.updated_at,
    }

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
    conversation = db.get(Conversation, message.conversation_id)
    if conversation and conversation.type == "group":
        await manager.broadcast_group(conversation.id, {"type": "message.new", "message": payload})
    else:
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
async def create_group(data: GroupIn, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    title = data.title.strip()
    if not title:
        raise HTTPException(422, "Group name cannot be empty")
    ids = set(data.member_ids + [me.id])
    existing_ids = set(db.scalars(select(User.id).where(User.id.in_(ids))).all())
    if ids != existing_ids:
        raise HTTPException(404, "One or more users were not found")
    c = Conversation(type="group", title=title, created_by=me.id)
    db.add(c); db.flush()
    for uid in ids:
        db.add(ConversationMember(conversation_id=c.id, user_id=uid, role="admin" if uid == me.id else "member"))
    db.commit()
    db.refresh(c)
    await notify_group_updated(db, c)
    return {"id": c.id, "title": c.title}

async def notify_group_updated(db: Session, group: Conversation):
    for user_id in member_ids(db, group.id):
        manager.join_group_user(user_id, group.id)
    await manager.broadcast_group(group.id, {"type": "group.updated", "group_id": group.id})

@app.post("/api/groups")
async def create_group_resource(data: GroupCreateIn, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    name = data.name.strip()
    if not name:
        raise HTTPException(422, "Group name cannot be empty")
    ids = set(data.member_ids + [me.id])
    existing_ids = set(db.scalars(select(User.id).where(User.id.in_(ids))).all())
    if ids != existing_ids:
        raise HTTPException(404, "One or more users were not found")
    group = Conversation(
        type="group",
        title=name,
        created_by=me.id,
        description=data.description,
        avatar_url=data.avatar_url,
    )
    db.add(group)
    db.flush()
    for user_id in ids:
        db.add(ConversationMember(
            conversation_id=group.id,
            user_id=user_id,
            role="admin" if user_id == me.id else "member",
        ))
    db.commit()
    db.refresh(group)
    await notify_group_updated(db, group)
    return conversation_payload(db, group, me.id) | {"members": group_members_payload(db, group.id)}

@app.get("/api/groups")
def list_groups(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    memberships = db.scalars(select(ConversationMember).where(
        ConversationMember.user_id == me.id
    )).all()
    groups = [
        db.get(Conversation, membership.conversation_id)
        for membership in memberships
    ]
    return sorted(
        [conversation_payload(db, group, me.id) for group in groups if group and group.type == "group"],
        key=lambda group: str(
            group["last_message"]["created_at"] if group["last_message"] else group["updated_at"]
        ),
        reverse=True,
    )

@app.get("/api/groups/{group_id}")
def get_group(group_id: int, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    group = require_group(db, group_id)
    require_group_member(db, group, me.id)
    return conversation_payload(db, group, me.id) | {"members": group_members_payload(db, group.id)}

@app.patch("/api/groups/{group_id}")
async def update_group(group_id: int, data: GroupUpdateIn, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    group = require_group(db, group_id)
    require_group_admin(db, group, me.id)
    changes = data.model_dump(exclude_unset=True)
    if "name" in changes:
        name = changes["name"].strip() if changes["name"] is not None else ""
        if not name:
            raise HTTPException(422, "Group name cannot be empty")
        group.title = name
    if "description" in changes:
        group.description = changes["description"]
    if "avatar_url" in changes:
        group.avatar_url = changes["avatar_url"]
    group.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(group)
    await notify_group_updated(db, group)
    return conversation_payload(db, group, me.id) | {"members": group_members_payload(db, group.id)}

@app.post("/api/groups/{group_id}/members")
async def add_group_members(group_id: int, data: GroupMembersIn, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    group = require_group(db, group_id)
    require_group_admin(db, group, me.id)
    requested_ids = set(data.user_ids) - {me.id}
    existing_ids = set(db.scalars(select(User.id).where(User.id.in_(requested_ids))).all()) if requested_ids else set()
    if requested_ids != existing_ids:
        raise HTTPException(404, "One or more users were not found")
    current_ids = set(member_ids(db, group.id))
    for user_id in requested_ids - current_ids:
        db.add(ConversationMember(conversation_id=group.id, user_id=user_id, role="member"))
    group.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(group)
    await notify_group_updated(db, group)
    return {"members": group_members_payload(db, group.id)}

def remove_group_member(db: Session, group: Conversation, user_id: int):
    membership = db.scalar(select(ConversationMember).where(
        ConversationMember.conversation_id == group.id,
        ConversationMember.user_id == user_id,
    ))
    if not membership:
        raise HTTPException(404, "Group member not found")
    admin_count = db.scalar(select(func.count(ConversationMember.id)).where(
        ConversationMember.conversation_id == group.id,
        ConversationMember.role == "admin",
    )) or 0
    if membership.role == "admin" and admin_count <= 1:
        raise HTTPException(409, "The group must have at least one admin")
    message_ids = select(Message.id).where(Message.conversation_id == group.id)
    db.execute(delete(MessageReceipt).where(
        MessageReceipt.user_id == user_id,
        MessageReceipt.message_id.in_(message_ids),
    ))
    db.delete(membership)
    group.updated_at = datetime.now(timezone.utc)

@app.delete("/api/groups/{group_id}/members/{user_id}")
async def delete_group_member(group_id: int, user_id: int, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    group = require_group(db, group_id)
    require_group_admin(db, group, me.id)
    remove_group_member(db, group, user_id)
    db.commit()
    await manager.send_user(user_id, {"type": "group.removed", "group_id": group.id})
    manager.leave_group(user_id, group.id)
    db.refresh(group)
    await notify_group_updated(db, group)
    return {"members": group_members_payload(db, group.id)}

@app.post("/api/groups/{group_id}/leave")
async def leave_group(group_id: int, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    group = require_group(db, group_id)
    require_group_member(db, group, me.id)
    remove_group_member(db, group, me.id)
    db.commit()
    await manager.send_user(me.id, {"type": "group.removed", "group_id": group.id})
    manager.leave_group(me.id, group.id)
    db.refresh(group)
    await notify_group_updated(db, group)
    return {"ok": True}

@app.patch("/api/groups/{group_id}/members/{user_id}/role")
async def update_group_role(group_id: int, user_id: int, data: GroupRoleIn, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    group = require_group(db, group_id)
    require_group_admin(db, group, me.id)
    membership = db.scalar(select(ConversationMember).where(
        ConversationMember.conversation_id == group.id,
        ConversationMember.user_id == user_id,
    ))
    if not membership:
        raise HTTPException(404, "Group member not found")
    if membership.role == "admin" and data.role != "admin":
        admin_count = db.scalar(select(func.count(ConversationMember.id)).where(
            ConversationMember.conversation_id == group.id,
            ConversationMember.role == "admin",
        )) or 0
        if admin_count <= 1:
            raise HTTPException(409, "The group must have at least one admin")
    membership.role = data.role
    group.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(group)
    await notify_group_updated(db, group)
    return {"members": group_members_payload(db, group.id)}

@app.get("/api/conversations")
def conversations(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    memberships = db.scalars(select(ConversationMember).where(ConversationMember.user_id == me.id)).all()
    result = [
        conversation_payload(db, conversation, me.id)
        for membership in memberships
        if (conversation := db.get(Conversation, membership.conversation_id))
    ]
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

@app.get("/api/groups/{group_id}/messages")
def get_group_messages(
    group_id: int,
    limit: int = Query(default=50, ge=1, le=100),
    before_id: int | None = Query(default=None, gt=0),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    me = current_user(authorization, db)
    group = require_group(db, group_id)
    require_group_member(db, group, me.id)
    query = select(Message).where(Message.conversation_id == group.id)
    if before_id is not None:
        cursor = db.get(Message, before_id)
        if not cursor or cursor.conversation_id != group.id:
            raise HTTPException(404, "Message cursor not found in this group")
        query = query.where(or_(
            Message.created_at < cursor.created_at,
            and_(Message.created_at == cursor.created_at, Message.id < cursor.id),
        ))
    rows = db.scalars(query.order_by(desc(Message.created_at), desc(Message.id)).limit(limit)).all()
    rows.reverse()
    ids = member_ids(db, group.id)
    backfilled = False
    for message in rows:
        existing_users = set(db.scalars(select(MessageReceipt.user_id).where(
            MessageReceipt.message_id == message.id
        )).all())
        for user_id in ids:
            if user_id != message.sender_id and user_id not in existing_users:
                db.add(MessageReceipt(message_id=message.id, user_id=user_id, status="sent"))
                backfilled = True
    if backfilled:
        db.commit()
    result = []
    for message in rows:
        receipt = db.scalar(select(MessageReceipt).where(
            MessageReceipt.message_id == message.id,
            MessageReceipt.user_id == me.id,
        ))
        result.append({
            "id": message.id,
            "client_id": message.client_id,
            "conversation_id": message.conversation_id,
            "sender_id": message.sender_id,
            "content": message.content,
            "reply_to_id": message.reply_to_id,
            "created_at": message.created_at,
            "status": message_status(db, message) if message.sender_id == me.id else (
                receipt.status if receipt else None
            ),
        })
    return result

async def persist_message(conversation_id: int, data: MessageIn, me: User, db: Session):
    conversation = db.get(Conversation, conversation_id)
    if not conversation:
        raise HTTPException(404, "Conversation not found")
    ids = member_ids(db, conversation_id)
    if me.id not in ids:
        raise HTTPException(403, "Not a conversation member")
    existing = db.scalar(select(Message).where(Message.client_id == data.client_id))
    if existing:
        if existing.sender_id != me.id or existing.conversation_id != conversation_id:
            raise HTTPException(409, "Client message ID is already in use")
        payload = {
            "id": existing.id,
            "client_id": existing.client_id,
            "conversation_id": existing.conversation_id,
            "sender_id": existing.sender_id,
            "content": existing.content,
            "created_at": existing.created_at,
            "status": message_status(db, existing),
            "duplicate": True,
        }
        return payload
    if data.reply_to_id is not None:
        reply = db.get(Message, data.reply_to_id)
        if not reply or reply.conversation_id != conversation_id:
            raise HTTPException(404, "Reply message not found in this conversation")
    msg = Message(
        client_id=data.client_id,
        conversation_id=conversation_id,
        sender_id=me.id,
        content=data.content,
        reply_to_id=data.reply_to_id,
    )
    db.add(msg)
    conversation.updated_at = datetime.now(timezone.utc)
    db.flush()
    for user_id in ids:
        if user_id != me.id:
            db.add(MessageReceipt(message_id=msg.id, user_id=user_id, status="sent"))
    db.commit()
    db.refresh(msg)
    return await broadcast_message(db, msg, ids)

@app.post("/api/conversations/{conversation_id}/messages")
async def send_message(conversation_id: int, data: MessageIn, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    return await persist_message(conversation_id, data, me, db)

@app.post("/api/groups/{group_id}/messages")
async def send_group_message(group_id: int, data: MessageIn, authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    me = current_user(authorization, db)
    group = require_group(db, group_id)
    require_group_member(db, group, me.id)
    return await persist_message(group.id, data, me, db)

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
    if data.status == "read":
        membership = db.scalar(select(ConversationMember).where(
            ConversationMember.conversation_id == msg.conversation_id,
            ConversationMember.user_id == me.id,
        ))
        if membership:
            membership.last_read_at = datetime.now(timezone.utc)
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
            conversation = db.get(Conversation, msg.conversation_id)
            if conversation and conversation.type == "group":
                membership = db.scalar(select(ConversationMember.id).where(
                    ConversationMember.conversation_id == conversation.id,
                    ConversationMember.user_id == user_id,
                ))
                if not membership:
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
    db = SessionLocal()
    try:
        if not db.get(User, user_id):
            await websocket.close(code=1008)
            return
    finally:
        db.close()
    await manager.connect(user_id, websocket)
    try:
        await deliver_pending_messages(user_id)
        while True:
            event = await websocket.receive_json()
            if event.get("type") == "group.join":
                group_id = event.get("group_id")
                if not isinstance(group_id, int):
                    await websocket.close(code=1008)
                    return
                db = SessionLocal()
                try:
                    group = db.get(Conversation, group_id)
                    if not group or group.type != "group" or not db.scalar(select(ConversationMember.id).where(
                        ConversationMember.conversation_id == group_id,
                        ConversationMember.user_id == user_id,
                    )):
                        await websocket.close(code=1008)
                        return
                    manager.join_group(user_id, group_id, websocket)
                finally:
                    db.close()
                continue
            if event.get("type") in ("typing.start", "typing.stop"):
                db = SessionLocal()
                try:
                    conversation_id = int(event["conversation_id"])
                    conversation = db.get(Conversation, conversation_id)
                    if not conversation or user_id not in member_ids(db, conversation_id):
                        continue
                    payload = {**event, "conversation_id": conversation_id, "user_id": user_id}
                    if conversation.type == "group":
                        sockets = manager.group_rooms.get(conversation_id, {}).get(user_id, set())
                        if websocket in sockets:
                            await manager.broadcast_group(conversation_id, payload)
                    else:
                        await manager.broadcast(
                            [uid for uid in member_ids(db, conversation_id) if uid != user_id],
                            payload,
                        )
                finally: db.close()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(user_id, websocket)