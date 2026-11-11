'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import {
  ArrowLeft, Check, CheckCheck, Clock3, LogOut, MessageSquare, MoreVertical,
  Paperclip, Phone, Plus, Search, Send, Settings, ShieldCheck, Smile, Users,
  Video, X,
} from 'lucide-react';
import { api, token, WS } from '@/lib/api';

type User = {
  id: number;
  username: string;
  display_name: string;
  avatar_url?: string | null;
  is_online?: boolean;
};
type GroupMember = User & {
  role: 'admin' | 'member';
  joined_at: string;
  last_read_at?: string | null;
};
type AuthResponse = { token: string; user: User };
type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read';
type Message = {
  id: number;
  client_id: string;
  conversation_id: number;
  sender_id: number;
  content: string;
  created_at: string;
  status?: MessageStatus;
};
type Conversation = {
  id: number;
  type: 'direct' | 'group';
  title: string;
  description?: string | null;
  avatar_url?: string | null;
  members: User[];
  member_roles?: Record<string, 'admin' | 'member'>;
  last_message: { content: string; created_at: string; sender_id: number } | null;
  unread_count: number;
};
type GroupDetails = Omit<Conversation, 'members'> & { members: GroupMember[] };
type ChatFilter = 'all' | 'unread' | 'groups';

const statusRank: Record<MessageStatus, number> = { sending: 0, sent: 1, delivered: 2, read: 3 };
const avatarColors = ['#dce9f8', '#f5e6dc', '#e7e3f7', '#dcefe5', '#f4e4ed'];
const initials = (value: string) => value.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();

function advanceStatus(current?: MessageStatus, next?: MessageStatus): MessageStatus {
  const left = current || 'sending';
  const right = next || left;
  return statusRank[right] > statusRank[left] ? right : left;
}

function conversationTitle(conversation: Conversation, userId: number) {
  if (conversation.type === 'group') return conversation.title;
  const other = conversation.members.find((member) => member.id !== userId);
  return other?.display_name || other?.username || 'Conversation';
}

function Avatar({ name, url, size = 42, online = false }: { name: string; url?: string | null; size?: number; online?: boolean }) {
  return (
    <div className="relative shrink-0">
      {url ? (
        <div
          role="img"
          aria-label={name}
          style={{ width: size, height: size, backgroundImage: `url("${url}")` }}
          className="rounded-full bg-cover bg-center"
        />
      ) : (
        <div
          style={{ width: size, height: size, background: avatarColors[name.length % avatarColors.length], fontSize: size * 0.32 }}
          className="flex items-center justify-center rounded-full font-semibold text-slate-600"
        >
          {initials(name) || '?'}
        </div>
      )}
      {online && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />}
    </div>
  );
}

function Auth({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('alex');
  const [password, setPassword] = useState('signal123');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const response: AuthResponse = await api(`/api/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(mode === 'login' ? { username, password } : { username, password, display_name: name || username }),
      });
      localStorage.setItem('signal_token', response.token);
      onLogin(response.user);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to sign in');
    }
  }

  return (
    <div className="auth-screen flex min-h-screen items-center justify-center p-5">
      <form onSubmit={submit} className="auth-card w-full max-w-[390px] rounded-2xl bg-white p-8 shadow-xl">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#3a76e8] text-2xl font-bold text-white">S</div>
        <h1 className="text-center text-2xl font-semibold">Signal</h1>
        <p className="mb-7 mt-2 text-center text-sm text-slate-500">Say hello to a different messaging experience.</p>
        {mode === 'register' && <input className="mb-3 w-full rounded-lg border p-3" placeholder="Display name" value={name} onChange={(event) => setName(event.target.value)} required />}
        <input className="mb-3 w-full rounded-lg border p-3" placeholder="Username" value={username} onChange={(event) => setUsername(event.target.value)} required />
        <input className="mb-3 w-full rounded-lg border p-3" placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <button className="w-full rounded-lg bg-[#3a76e8] p-3 font-medium text-white hover:bg-[#2e68d5]">{mode === 'login' ? 'Continue' : 'Create account'}</button>
        <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="mt-5 w-full text-sm text-[#3975df]">
          {mode === 'login' ? 'Create an account' : 'Back to login'}
        </button>
        <p className="mt-6 text-center text-xs text-slate-400">Demo: alex / signal123</p>
      </form>
    </div>
  );
}

export default function Home() {
  const [me, setMe] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [groupDetails, setGroupDetails] = useState<GroupDetails | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupAvatar, setGroupAvatar] = useState('');
  const [createQuery, setCreateQuery] = useState('');
  const [createUsers, setCreateUsers] = useState<User[]>([]);
  const [selectedCreateUsers, setSelectedCreateUsers] = useState<User[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [memberUsers, setMemberUsers] = useState<User[]>([]);
  const [memberIdsToAdd, setMemberIdsToAdd] = useState<number[]>([]);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [actionError, setActionError] = useState('');
  const [typing, setTyping] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedRef = useRef<number | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const conversationsRef = useRef<Conversation[]>([]);
  const groupDetailsRef = useRef<GroupDetails | null>(null);
  const mobileChatRef = useRef(mobileChat);
  const active = conversations.find((conversation) => conversation.id === selected) || null;

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  useEffect(() => { groupDetailsRef.current = groupDetails; }, [groupDetails]);
  useEffect(() => { mobileChatRef.current = mobileChat; }, [mobileChat]);

  const refresh = useCallback(async () => {
    const rows: Conversation[] = await api('/api/conversations');
    setConversations(rows);
    const connection = socket.current;
    if (connection?.readyState === WebSocket.OPEN) {
      rows.filter((conversation) => conversation.type === 'group').forEach((group) => {
        connection.send(JSON.stringify({ type: 'group.join', group_id: group.id }));
      });
    }
    return rows;
  }, []);

  const messagePath = useCallback((conversationId: number) => {
    const conversation = conversationsRef.current.find((item) => item.id === conversationId);
    return conversation?.type === 'group'
      ? `/api/groups/${conversationId}/messages`
      : `/api/conversations/${conversationId}/messages`;
  }, []);

  const markMessagesRead = useCallback(async (conversationId: number, rows: Message[]) => {
    const unread = rows.filter((message) => message.sender_id !== me?.id && message.id > 0 && message.status !== 'read');
    const results = await Promise.all(unread.map(async (message) => {
      try {
        await api(`/api/messages/${message.id}/receipt`, { method: 'POST', body: JSON.stringify({ status: 'read' }) });
        return message.id;
      } catch (error) {
        console.error(`Failed to mark message ${message.id} as read`, error);
        return null;
      }
    }));
    const readIds = new Set(results.filter((id): id is number => id !== null));
    if (readIds.size) {
      setMessages((old) => old.map((message) => message.conversation_id === conversationId && readIds.has(message.id)
        ? { ...message, status: 'read' }
        : message));
      void refresh().catch((error) => console.error('Failed to refresh conversations', error));
    }
  }, [me?.id, refresh]);

  const markMessagesDelivered = useCallback(async (rows: Message[]) => {
    const undelivered = rows.filter((message) => message.sender_id !== me?.id && message.id > 0 && message.status !== 'delivered' && message.status !== 'read');
    await Promise.all(undelivered.map(async (message) => {
      try {
        await api(`/api/messages/${message.id}/receipt`, { method: 'POST', body: JSON.stringify({ status: 'delivered' }) });
      } catch (error) {
        console.error(`Failed to mark message ${message.id} as delivered`, error);
      }
    }));
  }, [me?.id]);

  const syncConversation = useCallback(async (conversationId: number) => {
    try {
      const path = messagePath(conversationId);
      const url = path.startsWith('/api/groups/') ? `${path}?limit=100` : path;
      const latest: Message[] = await api(url);
      if (selectedRef.current !== conversationId) return;
      setMessages((old) => {
        const merged = latest.map((server) => {
          const current = old.find((message) => message.client_id === server.client_id);
          return current ? { ...server, status: advanceStatus(current.status, server.status) } : server;
        });
        return [...merged, ...old.filter((message) => message.id < 0 && !latest.some((server) => server.client_id === message.client_id))];
      });
      void markMessagesRead(conversationId, latest);
    } catch (error) {
      console.error(`Failed to sync conversation ${conversationId}`, error);
    }
  }, [markMessagesRead, messagePath]);

  const retryPendingMessages = useCallback(async () => {
    const pending = messagesRef.current.filter((message) => message.id < 0 && message.status === 'sending');
    for (const message of pending) {
      try {
        const result = await api(`${messagePath(message.conversation_id)}`, {
          method: 'POST',
          body: JSON.stringify({ client_id: message.client_id, content: message.content }),
        });
        setMessages((old) => old.map((current) => current.client_id === message.client_id
          ? { ...current, id: result.id, status: advanceStatus(current.status, result.status || 'sent') }
          : current));
      } catch (error) {
        console.error(`Failed to retry message ${message.client_id}`, error);
      }
    }
  }, [messagePath]);

  useEffect(() => {
    if (!token()) return;
    api('/api/me').then(setMe).catch(() => localStorage.removeItem('signal_token'));
  }, []);

  useEffect(() => {
    if (!me) return;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1000;
    let currentSocket: WebSocket | null = null;
    void api('/api/conversations').then((rows: Conversation[]) => {
      if (!disposed) setConversations(rows);
    }).catch((error) => console.error('Failed to load conversations', error));

    const connect = () => {
      if (disposed) return;
      const connection = new WebSocket(`${WS}/ws/${me.id}?token=${token()}`);
      currentSocket = connection;
      socket.current = connection;
      connection.onopen = () => {
        retryDelay = 1000;
        void refresh().then(() => retryPendingMessages()).catch((error) => console.error('Failed to restore messaging session', error));
        if (selectedRef.current) void syncConversation(selectedRef.current);
      };
      connection.onmessage = (event) => {
        let data: { type: string; message?: Message; message_id?: number; status?: MessageStatus; conversation_id?: number; user_id?: number; group_id?: number };
        try {
          data = JSON.parse(event.data);
        } catch (error) {
          console.error('Received invalid websocket payload', error);
          return;
        }
        if (data.type === 'message.new' && data.message) {
          const message = data.message;
          const visible = message.conversation_id === selectedRef.current
            && (mobileChatRef.current || window.matchMedia('(min-width: 768px)').matches);
          if (visible) {
            setMessages((old) => {
              const existing = old.find((item) => item.client_id === message.client_id);
              return existing
                ? old.map((item) => item.client_id === message.client_id
                  ? { ...item, ...message, status: advanceStatus(item.status, message.status) }
                  : item)
                : [...old, message];
            });
            if (message.sender_id !== me.id) void markMessagesRead(message.conversation_id, [message]);
          } else {
            void markMessagesDelivered([message]);
          }
          void refresh().catch((error) => console.error('Failed to refresh conversations', error));
        }
        if (data.type === 'receipt.update') {
          setMessages((old) => old.map((message) => message.id === data.message_id
            ? { ...message, status: advanceStatus(message.status, data.status) }
            : message));
        }
        if (data.type === 'typing.start' && data.conversation_id === selectedRef.current && data.user_id !== me.id) setTyping(true);
        if (data.type === 'typing.stop' && data.conversation_id === selectedRef.current) setTyping(false);
        if (data.type === 'group.updated' && data.group_id) {
          void refresh().catch((error) => console.error('Failed to refresh group list', error));
          if (selectedRef.current === data.group_id) void syncConversation(data.group_id);
          if (groupDetailsRef.current?.id === data.group_id) {
            void api(`/api/groups/${data.group_id}`).then(setGroupDetails).catch((error) => {
              console.error(`Failed to refresh group ${data.group_id}`, error);
            });
          }
        }
        if (data.type === 'group.removed' && data.group_id) {
          setSelected((current) => current === data.group_id ? null : current);
          if (selectedRef.current === data.group_id) setMessages([]);
          if (groupDetailsRef.current?.id === data.group_id) setGroupDetails(null);
          void refresh().catch((error) => console.error('Failed to refresh conversations', error));
        }
      };
      connection.onclose = () => {
        if (socket.current === connection) socket.current = null;
        if (!disposed) {
          setTyping(false);
          retryTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30000);
        }
      };
      connection.onerror = () => connection.close();
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (socket.current === currentSocket) socket.current = null;
      currentSocket?.close();
    };
  }, [me, markMessagesDelivered, markMessagesRead, refresh, retryPendingMessages, syncConversation]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const conversation = conversationsRef.current.find((item) => item.id === selected);
    const path = conversation?.type === 'group'
      ? `/api/groups/${selected}/messages?limit=100`
      : `/api/conversations/${selected}/messages`;
    api(path).then((rows: Message[]) => {
      if (!cancelled) {
        setMessages(rows);
        void markMessagesRead(selected, rows);
      }
    }).catch((error) => console.error(`Failed to load messages for conversation ${selected}`, error));
    return () => { cancelled = true; };
  }, [selected, markMessagesRead]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const visibleConversations = useMemo(() => conversations.filter((conversation) => {
    const title = conversationTitle(conversation, me?.id || 0).toLowerCase();
    if (query && !title.includes(query.toLowerCase())) return false;
    if (filter === 'groups' && conversation.type !== 'group') return false;
    if (filter === 'unread' && !conversation.unread_count) return false;
    return true;
  }), [conversations, filter, me?.id, query]);

  async function searchUsers(value: string, setResults: (rows: User[]) => void) {
    if (!value.trim()) {
      setResults([]);
      return;
    }
    try {
      const rows: User[] = await api(`/api/users?q=${encodeURIComponent(value.trim())}`);
      setResults(rows);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'User search failed');
    }
  }

  async function openUser(user: User) {
    try {
      const conversation = await api(`/api/conversations/direct/${user.id}`, { method: 'POST' });
      await refresh();
      if (selected !== conversation.id) setMessages([]);
      setSelected(conversation.id);
      setShowNew(false);
      setMobileChat(true);
      setQuery('');
      setUsers([]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not open conversation');
    }
  }

  async function createGroup() {
    if (!groupName.trim()) {
      setActionError('Enter a group name.');
      return;
    }
    try {
      const group: Conversation = await api('/api/groups', {
        method: 'POST',
        body: JSON.stringify({
          name: groupName.trim(),
          description: groupDescription.trim() || null,
          avatar_url: groupAvatar.trim() || null,
          member_ids: selectedUserIds,
        }),
      });
      await refresh();
      setSelected(group.id);
      setMessages([]);
      setMobileChat(true);
      setShowNew(false);
      setGroupName('');
      setGroupDescription('');
      setGroupAvatar('');
      setCreateQuery('');
      setCreateUsers([]);
      setSelectedCreateUsers([]);
      setSelectedUserIds([]);
      setActionError('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not create group');
    }
  }

  async function openGroupInfo(conversation: Conversation) {
    try {
      const details: GroupDetails = await api(`/api/groups/${conversation.id}`);
      setGroupDetails(details);
      setEditName(details.title);
      setEditDescription(details.description || '');
      setEditAvatar(details.avatar_url || '');
      setMemberQuery('');
      setMemberUsers([]);
      setMemberIdsToAdd([]);
      setActionError('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not load group details');
    }
  }

  async function updateGroup() {
    if (!groupDetails) return;
    try {
      const updated: GroupDetails = await api(`/api/groups/${groupDetails.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
          avatar_url: editAvatar.trim() || null,
        }),
      });
      setGroupDetails(updated);
      await refresh();
      setActionError('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update group');
    }
  }

  async function addMembers() {
    if (!groupDetails || !memberIdsToAdd.length) return;
    try {
      const result = await api(`/api/groups/${groupDetails.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ user_ids: memberIdsToAdd }),
      });
      setGroupDetails({ ...groupDetails, members: result.members });
      setMemberIdsToAdd([]);
      setMemberQuery('');
      setMemberUsers([]);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not add members');
    }
  }

  async function removeMember(userId: number) {
    if (!groupDetails) return;
    try {
      const result = await api(`/api/groups/${groupDetails.id}/members/${userId}`, { method: 'DELETE' });
      setGroupDetails({ ...groupDetails, members: result.members });
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not remove member');
    }
  }

  async function updateRole(member: GroupMember) {
    if (!groupDetails) return;
    try {
      const result = await api(`/api/groups/${groupDetails.id}/members/${member.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: member.role === 'admin' ? 'member' : 'admin' }),
      });
      setGroupDetails({ ...groupDetails, members: result.members });
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update member role');
    }
  }

  async function leaveGroup() {
    if (!groupDetails) return;
    try {
      await api(`/api/groups/${groupDetails.id}/leave`, { method: 'POST' });
      const groupId = groupDetails.id;
      setGroupDetails(null);
      setSelected((current) => current === groupId ? null : current);
      setMessages([]);
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not leave group');
    }
  }

  async function sendMessage() {
    if (!draft.trim() || !selected || !me) return;
    const content = draft.trim();
    setDraft('');
    const clientId = crypto.randomUUID();
    const optimistic: Message = {
      id: -Date.now(),
      client_id: clientId,
      conversation_id: selected,
      sender_id: me.id,
      content,
      created_at: new Date().toISOString(),
      status: 'sending',
    };
    setMessages((old) => [...old, optimistic]);
    try {
      const result = await api(messagePath(selected), {
        method: 'POST',
        body: JSON.stringify({ client_id: clientId, content }),
      });
      setMessages((old) => old.map((message) => message.client_id === clientId
        ? { ...message, id: result.id, status: advanceStatus(message.status, result.status || 'sent') }
        : message));
      await refresh();
    } catch (error) {
      console.error('Message remains queued and will retry after reconnect', error);
      setActionError(error instanceof Error ? error.message : 'Message could not be sent yet');
    }
  }

  function typingEvent(value: string) {
    setDraft(value);
    const connection = socket.current;
    if (!selected || !connection || connection.readyState !== WebSocket.OPEN) return;
    connection.send(JSON.stringify({ type: 'typing.start', conversation_id: selected }));
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      const activeSocket = socket.current;
      if (activeSocket?.readyState === WebSocket.OPEN) {
        activeSocket.send(JSON.stringify({ type: 'typing.stop', conversation_id: selected }));
      }
      typingTimer.current = null;
    }, 1200);
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('Failed to update logout status', error);
    }
    localStorage.removeItem('signal_token');
    setMe(null);
    setConversations([]);
    setSelected(null);
    setMessages([]);
  }

  function handleComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  if (!me) return <Auth onLogin={setMe} />;
  const other = active?.members.find((member) => member.id !== me.id);
  const isGroupAdmin = groupDetails?.members.some((member) => member.id === me.id && member.role === 'admin') || false;
  const selectedName = active ? conversationTitle(active, me.id) : '';

  return (
    <main className="messenger-shell flex h-screen w-screen overflow-hidden bg-white text-[#292d32]">
      <aside className={`conversation-sidebar ${mobileChat ? 'hidden' : 'flex'} w-full shrink-0 flex-col border-r border-[#e8eaed] md:flex md:w-[390px]`}>
        <div className="flex h-[68px] items-center justify-between border-b border-[#eff0f2] px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3a76e8] font-bold text-white">S</div>
            <span className="text-[19px] font-semibold">Signal</span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setShowNew(true); setActionError(''); }} className="rounded-full p-2 hover:bg-slate-100" title="New message"><Plus size={20} /></button>
            <button onClick={() => setShowSettings(true)} className="rounded-full p-2 hover:bg-slate-100" title="Settings"><Settings size={19} /></button>
          </div>
        </div>
        <div className="p-4 pb-2">
          <div className="flex h-10 items-center gap-2 rounded-xl bg-[#f1f3f5] px-3">
            <Search size={17} className="text-slate-500" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                void searchUsers(event.target.value, setUsers);
              }}
              placeholder="Search people and groups"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
          <div className="mt-3 flex gap-2 text-xs">
            {(['all', 'unread', 'groups'] as ChatFilter[]).map((value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={`rounded-full px-3 py-1.5 capitalize ${filter === value ? 'bg-[#eaf1ff] text-[#316ed8]' : 'text-slate-500 hover:bg-slate-100'}`}
              >
                {value === 'all' ? 'All chats' : value}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {query && users.length > 0 && <div className="px-4 pt-2 text-xs uppercase text-slate-400">People</div>}
          {query && users.map((user) => (
            <button key={user.id} onClick={() => void openUser(user)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
              <Avatar name={user.display_name} url={user.avatar_url} />
              <div><div className="text-sm font-medium">{user.display_name}</div><div className="text-xs text-slate-500">@{user.username}</div></div>
            </button>
          ))}
          {visibleConversations.map((conversation) => {
            const title = conversationTitle(conversation, me.id);
            const online = conversation.members.some((member) => member.id !== me.id && member.is_online);
            const lastSender = conversation.members.find((member) => member.id === conversation.last_message?.sender_id);
            return (
              <button
                key={conversation.id}
                onClick={() => {
                  if (selected !== conversation.id) setMessages([]);
                  setSelected(conversation.id);
                  setMobileChat(true);
                }}
                className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-[#f7f8fa] ${selected === conversation.id ? 'bg-[#f0f4fa]' : ''}`}
              >
                <Avatar name={title} url={conversation.avatar_url} online={online} />
                <div className="min-w-0 flex-1 border-b border-[#f0f1f2] pb-3">
                  <div className="flex justify-between gap-2">
                    <span className="truncate text-[14px] font-medium">{title}</span>
                    <span className="text-[11px] text-slate-400">
                      {conversation.last_message ? new Date(conversation.last_message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] text-slate-500">
                      {conversation.last_message
                        ? `${conversation.last_message.sender_id === me.id ? 'You' : lastSender?.display_name || ''}: ${conversation.last_message.content}`
                        : conversation.type === 'group' ? 'Group created' : 'Start a conversation'}
                    </span>
                    {conversation.unread_count > 0 && <span className="min-w-5 rounded-full bg-[#3a76e8] px-1.5 py-0.5 text-center text-[10px] text-white">{conversation.unread_count}</span>}
                  </div>
                </div>
              </button>
            );
          })}
          {!visibleConversations.length && !users.length && <p className="px-5 py-8 text-center text-sm text-slate-400">No conversations found</p>}
        </div>
        <div className="flex min-h-[68px] items-center gap-3 border-t border-[#eff0f2] p-3">
          <Avatar name={me.display_name} url={me.avatar_url} size={36} />
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{me.display_name}</div><div className="text-xs text-slate-400">Available</div></div>
          <button onClick={() => void logout()} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" title="Sign out"><LogOut size={17} /></button>
        </div>
      </aside>

      <section className={`chat-panel ${mobileChat ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col bg-white md:flex`}>
        {active ? (
          <>
            <header className="flex h-[68px] items-center gap-3 border-b border-[#eff0f2] px-5">
              <button className="p-1 md:hidden" onClick={() => setMobileChat(false)}><ArrowLeft /></button>
              <button onClick={() => active.type === 'group' && void openGroupInfo(active)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <Avatar name={selectedName} url={active.avatar_url} size={40} online={!!other?.is_online} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">{selectedName}</span>
                  <span className="block text-xs text-slate-500">
                    {active.type === 'group'
                      ? `${active.members.length} members · ${active.members.filter((member) => member.is_online).length} online`
                      : other?.is_online ? 'online' : 'last seen recently'}
                  </span>
                </span>
              </button>
              <button className="rounded-full p-2 text-slate-500 hover:bg-slate-100" title="Voice call (coming soon)"><Phone size={19} /></button>
              <button className="rounded-full p-2 text-slate-500 hover:bg-slate-100" title="Video call (coming soon)"><Video size={19} /></button>
              {active.type === 'group'
                ? <button onClick={() => void openGroupInfo(active)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" title="Group information"><Users size={19} /></button>
                : <button className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><MoreVertical size={19} /></button>}
            </header>
            <div className="flex-1 overflow-y-auto bg-white px-5 py-6 md:px-12">
              <div className="mx-auto flex max-w-[850px] flex-col gap-2">
                {messages.map((message) => {
                  const mine = message.sender_id === me.id;
                  const sender = active.members.find((member) => member.id === message.sender_id);
                  return (
                    <div key={message.client_id || message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 shadow-[0_1px_1px_rgba(0,0,0,.04)] md:max-w-[65%] ${mine ? 'rounded-br-md bg-[#dce9ff]' : 'rounded-bl-md bg-[#f1f2f4]'}`}>
                        {active.type === 'group' && <div className="mb-1 text-[11px] font-semibold text-[#3975df]">{mine ? 'You' : sender?.display_name || sender?.username || 'Member'}</div>}
                        <div className="whitespace-pre-wrap break-words text-[14px] leading-[1.5]">{message.content}</div>
                        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-400">
                          {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {mine && (message.status === 'sending'
                            ? <Clock3 size={13} aria-label="Sending" />
                            : message.status === 'sent'
                              ? <Check size={13} aria-label="Sent" />
                              : <CheckCheck size={13} className={message.status === 'read' ? 'text-[#3c78df]' : 'text-slate-400'} aria-label={message.status === 'read' ? 'Read' : 'Delivered'} />)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {typing && <div className="px-2 text-xs text-slate-400">Someone is typing…</div>}
                <div ref={endRef} />
              </div>
            </div>
            <div className="px-5 py-4 md:px-10">
              <div className="mx-auto flex max-w-[850px] items-end gap-2 rounded-2xl border border-[#e6e8eb] px-3 py-2 shadow-sm">
                <button className="p-2 text-slate-400 hover:text-slate-600" title="Attachments (coming soon)"><Paperclip size={20} /></button>
                <textarea
                  value={draft}
                  onChange={(event) => typingEvent(event.target.value)}
                  onKeyDown={handleComposerKey}
                  placeholder="Write a message..."
                  rows={1}
                  className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none"
                />
                <button className="p-2 text-slate-400 hover:text-slate-600" title="Emoji (coming soon)"><Smile size={20} /></button>
                <button onClick={() => void sendMessage()} disabled={!draft.trim()} className="rounded-xl bg-[#3a76e8] p-2.5 text-white disabled:opacity-40"><Send size={17} /></button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-[26px] bg-[#eaf1ff] text-[#3a76e8]"><MessageSquare size={34} /></div>
            <h2 className="text-xl font-semibold">Your messages, your space</h2>
            <p className="mt-2 text-sm text-slate-500">Select a conversation or start a new one.</p>
            <button onClick={() => setShowNew(true)} className="mt-5 rounded-lg bg-[#3a76e8] px-4 py-2 text-sm font-medium text-white">New message</button>
          </div>
        )}
      </section>

      {showNew && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">New conversation</h2>
              <button onClick={() => setShowNew(false)} className="rounded-full p-2 hover:bg-slate-100"><X size={18} /></button>
            </div>
            <button onClick={() => document.getElementById('new-group-name')?.focus()} className="mb-4 flex w-full items-center gap-3 rounded-xl border p-3 text-left hover:bg-slate-50">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#eaf1ff] text-[#3a76e8]"><Users size={20} /></span>
              <span><span className="block font-medium">Create a group</span><span className="text-xs text-slate-500">Start a conversation with multiple people</span></span>
            </button>
            {actionError && <p className="mb-3 text-sm text-red-600">{actionError}</p>}
            <input
              value={createQuery}
              onChange={(event) => { setCreateQuery(event.target.value); void searchUsers(event.target.value, setCreateUsers); }}
              placeholder="Search registered users"
              className="mb-3 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:border-[#3a76e8]"
            />
            {selectedUserIds.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {selectedCreateUsers.map((user) => (
                  <button key={user.id} onClick={() => {
                    setSelectedUserIds((ids) => ids.filter((id) => id !== user.id));
                    setSelectedCreateUsers((selectedUsers) => selectedUsers.filter((item) => item.id !== user.id));
                  }} className="rounded-full bg-[#eaf1ff] px-3 py-1 text-xs text-[#316ed8]">
                    {user.display_name} ×
                  </button>
                ))}
              </div>
            )}
            <div className="max-h-44 overflow-y-auto">
              {createUsers.map((user) => (
                <button key={user.id} onClick={() => {
                  setSelectedUserIds((ids) => ids.includes(user.id) ? ids.filter((id) => id !== user.id) : [...ids, user.id]);
                  setSelectedCreateUsers((selectedUsers) => selectedUsers.some((item) => item.id === user.id)
                    ? selectedUsers.filter((item) => item.id !== user.id)
                    : [...selectedUsers, user]);
                }} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-slate-50">
                  <Avatar name={user.display_name} url={user.avatar_url} size={36} />
                  <span className="flex-1"><span className="block text-sm font-medium">{user.display_name}</span><span className="text-xs text-slate-500">@{user.username}</span></span>
                  <input type="checkbox" checked={selectedUserIds.includes(user.id)} readOnly />
                </button>
              ))}
            </div>
            {selectedUserIds.length > 0 && (
              <button onClick={() => {
                const user = selectedCreateUsers.find((candidate) => candidate.id === selectedUserIds[0]);
                if (selectedUserIds.length === 1 && user) void openUser(user);
                else setActionError('Choose Create a group to message multiple people.');
              }} className="mt-4 w-full rounded-lg border border-[#3a76e8] py-2 text-sm text-[#316ed8]">
                Start one-to-one chat
              </button>
            )}
            <div className="mt-4 border-t pt-4">
              <h3 className="mb-3 font-medium">Group details</h3>
              <input id="new-group-name" value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Group name" maxLength={100} className="mb-2 w-full rounded-lg border px-3 py-2 text-sm" />
              <textarea value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} placeholder="Description (optional)" maxLength={500} rows={2} className="mb-2 w-full rounded-lg border px-3 py-2 text-sm" />
              <input value={groupAvatar} onChange={(event) => setGroupAvatar(event.target.value)} placeholder="Group avatar image URL (optional)" maxLength={500} className="mb-3 w-full rounded-lg border px-3 py-2 text-sm" />
              <button onClick={() => void createGroup()} disabled={!groupName.trim()} className="w-full rounded-lg bg-[#3a76e8] py-2.5 text-sm font-medium text-white disabled:opacity-40">Create group</button>
              <p className="mt-2 text-xs text-slate-400">Select participants above; the creator is included automatically.</p>
            </div>
          </div>
        </div>
      )}

      {groupDetails && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Group information</h2>
              <button onClick={() => setGroupDetails(null)} className="rounded-full p-2 hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="mb-5 flex items-center gap-3">
              <Avatar name={groupDetails.title} url={groupDetails.avatar_url} size={54} />
              <div><div className="font-semibold">{groupDetails.title}</div><div className="text-sm text-slate-500">{groupDetails.members.length} participants</div></div>
            </div>
            {actionError && <p className="mb-3 text-sm text-red-600">{actionError}</p>}
            <p className="mb-4 text-sm text-slate-600">{groupDetails.description || 'No group description.'}</p>
            {isGroupAdmin && (
              <div className="mb-5 space-y-2 rounded-xl bg-slate-50 p-3">
                <h3 className="text-sm font-semibold">Edit group</h3>
                <input value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="Group name" className="w-full rounded-lg border px-3 py-2 text-sm" />
                <textarea value={editDescription} onChange={(event) => setEditDescription(event.target.value)} placeholder="Description" rows={2} className="w-full rounded-lg border px-3 py-2 text-sm" />
                <input value={editAvatar} onChange={(event) => setEditAvatar(event.target.value)} placeholder="Avatar image URL" className="w-full rounded-lg border px-3 py-2 text-sm" />
                <button onClick={() => void updateGroup()} className="rounded-lg bg-[#3a76e8] px-4 py-2 text-sm text-white">Save changes</button>
              </div>
            )}
            <h3 className="mb-2 text-sm font-semibold">Participants</h3>
            <div className="mb-4 space-y-1">
              {groupDetails.members.map((member) => (
                <div key={member.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                  <Avatar name={member.display_name} url={member.avatar_url} size={36} online={member.is_online} />
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{member.display_name}{member.id === me.id ? ' (you)' : ''}</div><div className="text-xs text-slate-500">@{member.username}</div></div>
                  <span className="flex items-center gap-1 text-xs text-slate-500">{member.role === 'admin' && <ShieldCheck size={14} />}{member.role}</span>
                  {isGroupAdmin && member.id !== me.id && (
                    <>
                      <button onClick={() => void updateRole(member)} className="text-xs text-[#316ed8]">{member.role === 'admin' ? 'Demote' : 'Promote'}</button>
                      <button onClick={() => void removeMember(member.id)} className="text-xs text-red-600">Remove</button>
                    </>
                  )}
                </div>
              ))}
            </div>
            {isGroupAdmin && (
              <div className="mb-4 border-t pt-4">
                <h3 className="mb-2 text-sm font-semibold">Add members</h3>
                <input value={memberQuery} onChange={(event) => { setMemberQuery(event.target.value); void searchUsers(event.target.value, setMemberUsers); }} placeholder="Search users" className="mb-2 w-full rounded-lg border px-3 py-2 text-sm" />
                <div className="max-h-32 overflow-y-auto">
                  {memberUsers.filter((user) => !groupDetails.members.some((member) => member.id === user.id)).map((user) => (
                    <button key={user.id} onClick={() => setMemberIdsToAdd((ids) => ids.includes(user.id) ? ids.filter((id) => id !== user.id) : [...ids, user.id])} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-50">
                      <Avatar name={user.display_name} url={user.avatar_url} size={30} />
                      <span className="flex-1 text-sm">{user.display_name}</span>
                      <input type="checkbox" checked={memberIdsToAdd.includes(user.id)} readOnly />
                    </button>
                  ))}
                </div>
                {!!memberIdsToAdd.length && <button onClick={() => void addMembers()} className="mt-2 rounded-lg bg-[#3a76e8] px-4 py-2 text-sm text-white">Add selected members</button>}
              </div>
            )}
            <button onClick={() => void leaveGroup()} className="w-full rounded-lg border border-red-200 py-2 text-sm text-red-600 hover:bg-red-50">Leave group</button>
          </div>
        </div>
      )}

      {showSettings && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Settings</h2><button onClick={() => setShowSettings(false)}><X size={18} /></button></div>
            <p className="text-sm text-slate-500">Signed in as {me.display_name}.</p>
            <button onClick={() => void logout()} className="mt-5 w-full rounded-lg border py-2 text-sm hover:bg-slate-50">Sign out</button>
          </div>
        </div>
      )}
    </main>
  );
}
