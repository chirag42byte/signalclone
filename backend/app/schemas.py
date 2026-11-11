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

class GroupCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=500)
    avatar_url: Optional[str] = Field(default=None, max_length=500)
    member_ids: list[int] = Field(default_factory=list)

class GroupUpdateIn(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = Field(default=None, max_length=500)
    avatar_url: Optional[str] = Field(default=None, max_length=500)

class GroupMembersIn(BaseModel):
    user_ids: list[int] = Field(min_length=1)

class GroupRoleIn(BaseModel):
    role: Literal["admin", "member"]

class MessageIn(BaseModel):
    client_id: str
    content: str
    reply_to_id: Optional[int] = None

class ReceiptIn(BaseModel):
    status: Literal["delivered", "read"]
