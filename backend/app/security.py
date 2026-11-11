from passlib.context import CryptContext
from jose import jwt
from datetime import datetime, timedelta, timezone
import os

pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
SECRET = os.getenv("SECRET_KEY")
if not SECRET:
    if os.getenv("APP_ENV", "development").lower() == "production":
        raise RuntimeError("SECRET_KEY must be configured in production")
    SECRET = "local-development-only-change-before-deploying"
ALGORITHM = "HS256"

def hash_password(value: str) -> str:
    return pwd.hash(value)

def verify_password(value: str, hashed: str) -> bool:
    return pwd.verify(value, hashed)

def create_token(user_id: int) -> str:
    payload = {"sub": str(user_id), "exp": datetime.now(timezone.utc) + timedelta(days=7)}
    return jwt.encode(payload, SECRET, algorithm=ALGORITHM)

def decode_token(token: str) -> int:
    return int(jwt.decode(token, SECRET, algorithms=[ALGORITHM])["sub"])
