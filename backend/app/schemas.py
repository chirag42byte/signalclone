from pydantic import BaseModel, Field
from typing import Literal, Optional

class RegisterIn(BaseModel):
    username: str
    password: str
    display_name: str
    phone: Optional[str] = None

class LoginIn(BaseModel):
    username: str
    password: str

class ContactIn(BaseModel):
    username: str
    nickname: Optional[str] = None

class GroupIn(BaseModel):
    title: str
    member_ids: list[int] = Field(default_factory=list)

class MessageIn(BaseModel):
    client_id: str
    content: str
    reply_to_id: Optional[int] = None

class ReceiptIn(BaseModel):
    status: Literal["delivered", "read"]
