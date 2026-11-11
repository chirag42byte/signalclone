from app.database import Base, engine, SessionLocal
from app.models import User, Conversation, ConversationMember, Message
from app.security import hash_password
from sqlalchemy import select
from datetime import datetime, timezone, timedelta

Base.metadata.create_all(bind=engine)
db = SessionLocal()
if not db.scalar(select(User).limit(1)):
    people = [
        User(username="alex", password_hash=hash_password("signal123"), display_name="Alex Morgan"),
        User(username="sam", password_hash=hash_password("signal123"), display_name="Sam Rivera"),
        User(username="jordan", password_hash=hash_password("signal123"), display_name="Jordan Lee"),
        User(username="taylor", password_hash=hash_password("signal123"), display_name="Taylor Kim"),
    ]
    db.add_all(people); db.flush()
    c1 = Conversation(type="direct"); c2 = Conversation(type="group", title="Weekend plans")
    db.add_all([c1,c2]); db.flush()
    db.add_all([
        ConversationMember(conversation_id=c1.id,user_id=people[0].id,role="admin"),
        ConversationMember(conversation_id=c1.id,user_id=people[1].id),
        ConversationMember(conversation_id=c2.id,user_id=people[0].id,role="admin"),
        ConversationMember(conversation_id=c2.id,user_id=people[1].id),
        ConversationMember(conversation_id=c2.id,user_id=people[2].id),
        ConversationMember(conversation_id=c2.id,user_id=people[3].id),
    ])
    now = datetime.now(timezone.utc)
    db.add_all([
        Message(client_id="seed-1",conversation_id=c1.id,sender_id=people[1].id,content="Hey! How's your week going?",created_at=now-timedelta(minutes=28)),
        Message(client_id="seed-2",conversation_id=c1.id,sender_id=people[0].id,content="Pretty good. Finally got some time to work on that project.",created_at=now-timedelta(minutes=24)),
        Message(client_id="seed-3",conversation_id=c1.id,sender_id=people[1].id,content="Nice! Would love to see it when you're ready.",created_at=now-timedelta(minutes=20)),
        Message(client_id="seed-4",conversation_id=c2.id,sender_id=people[2].id,content="Saturday afternoon works for me 🌿",created_at=now-timedelta(hours=2)),
    ])
    db.commit()
db.close()
print("Seed complete. Demo login: alex / signal123")
