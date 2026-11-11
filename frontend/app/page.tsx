'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, token, WS } from '@/lib/api';
import { Search, Plus, Settings, MessageSquare, Users, Send, Paperclip, Smile, Phone, Video, MoreVertical, ArrowLeft, LogOut, Check, CheckCheck, Clock3, X, Moon, ShieldCheck } from 'lucide-react';

type User = { id:number; username:string; display_name:string; avatar_url?:string|null; is_online?:boolean };
type AuthResponse = { token:string; user:User };
type MessageStatus = 'sending'|'sent'|'delivered'|'read';
type Message = { id:number; client_id:string; conversation_id:number; sender_id:number; content:string; created_at:string; status?:MessageStatus };
type Conversation = { id:number; type:string; title:string; members:User[]; last_message: {content:string;created_at:string;sender_id:number}|null };
const statusRank: Record<MessageStatus, number> = { sending:0, sent:1, delivered:2, read:3 };
function advanceStatus(current: MessageStatus|undefined, next: MessageStatus|undefined): MessageStatus {
 const left = current || 'sending'; const right = next || left;
 return statusRank[right] > statusRank[left] ? right : left;
}
const initials = (s:string) => s.split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();
const colors = ['#dce9f8','#f5e6dc','#e7e3f7','#dcefe5','#f4e4ed'];
function Avatar({name,size=42,online=false}:{name:string;size?:number;online?:boolean}) {
 return <div className="relative shrink-0"><div style={{width:size,height:size,background:colors[name.length%colors.length],fontSize:size*.32}} className="rounded-full flex items-center justify-center font-semibold text-slate-600">{initials(name)}</div>{online&&<span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 border-2 border-white"/>}</div>
}
function Auth({onLogin}:{onLogin:(user:User)=>void}) {
 const [mode,setMode]=useState<'login'|'register'>('login'); const [username,setUsername]=useState('alex'); const [password,setPassword]=useState('signal123'); const [name,setName]=useState(''); const [error,setError]=useState('');
 async function submit(e:React.FormEvent){e.preventDefault();setError('');try{const r:AuthResponse=await api(`/api/auth/${mode}`,{method:'POST',body:JSON.stringify(mode==='login'?{username,password}:{username,password,display_name:name||username})});localStorage.setItem('signal_token',r.token);onLogin(r.user)}catch(err){setError(err instanceof Error?err.message:'Unable to sign in')}}
 return <div className="auth-screen min-h-screen flex items-center justify-center p-5"><form onSubmit={submit} className="auth-card bg-white rounded-2xl shadow-xl w-full max-w-[390px] p-8"><div className="mx-auto mb-5 h-14 w-14 rounded-2xl bg-[#3a76e8] text-white flex items-center justify-center text-2xl font-bold">S</div><h1 className="text-center text-2xl font-semibold">Signal</h1><p className="text-center text-slate-500 text-sm mt-2 mb-7">Say hello to a different messaging experience.</p>{mode==='register'&&<input className="w-full border rounded-lg p-3 mb-3" placeholder="Display name" value={name} onChange={e=>setName(e.target.value)} required/>}<input className="w-full border rounded-lg p-3 mb-3" placeholder="Username" value={username} onChange={e=>setUsername(e.target.value)} required/><input className="w-full border rounded-lg p-3 mb-3" placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required/>{error&&<p className="text-red-600 text-sm mb-3">{error}</p>}<button className="w-full bg-[#3a76e8] hover:bg-[#2e68d5] text-white rounded-lg p-3 font-medium">{mode==='login'?'Continue':'Create account'}</button><button type="button" onClick={()=>setMode(mode==='login'?'register':'login')} className="w-full text-sm text-[#3975df] mt-5">{mode==='login'?'Create an account':'Back to login'}</button><p className="text-xs text-slate-400 text-center mt-6">Demo: alex / signal123</p></form></div>
}
export default function Home(){
 const [me,setMe]=useState<User|null>(null); const [convos,setConvos]=useState<Conversation[]>([]); const [selected,setSelected]=useState<number|null>(null); const [messages,setMessages]=useState<Message[]>([]); const [draft,setDraft]=useState(''); const [query,setQuery]=useState(''); const [users,setUsers]=useState<User[]>([]); const [showNew,setShowNew]=useState(false); const [showSettings,setShowSettings]=useState(false); const [typing,setTyping]=useState(false); const [mobileChat,setMobileChat]=useState(false); const socket=useRef<WebSocket|null>(null); const endRef=useRef<HTMLDivElement>(null); const typingTimer=useRef<ReturnType<typeof setTimeout>|null>(null); const selectedRef=useRef<number|null>(null); const messagesRef=useRef<Message[]>([]); const mobileChatRef=useRef(mobileChat);
 const active=convos.find(c=>c.id===selected)||null;
 async function refresh(){const c=await api('/api/conversations');setConvos(c)}
 useEffect(()=>{selectedRef.current=selected},[selected]);
 useEffect(()=>{messagesRef.current=messages},[messages]);
 useEffect(()=>{mobileChatRef.current=mobileChat},[mobileChat]);
 const markMessagesRead=useCallback(async (conversationId:number, rows:Message[])=>{
  const unread=rows.filter(m=>m.sender_id!==me?.id&&m.id>0&&m.status!=='read');
  const results=await Promise.all(unread.map(async m=>{try{await api(`/api/messages/${m.id}/receipt`,{method:'POST',body:JSON.stringify({status:'read'})});return m.id}catch(error){console.error(`Failed to mark message ${m.id} as read`,error);return null}}));
  const readIds=new Set(results.filter((id):id is number=>id!==null));
  if(readIds.size)setMessages(old=>old.map(m=>m.conversation_id===conversationId&&readIds.has(m.id)?{...m,status:'read'}:m));
 },[me?.id]);
 const markMessagesDelivered=useCallback(async (rows:Message[])=>{
  const undelivered=rows.filter(m=>m.sender_id!==me?.id&&m.id>0&&m.status!=='delivered'&&m.status!=='read');
  await Promise.all(undelivered.map(async m=>{try{await api(`/api/messages/${m.id}/receipt`,{method:'POST',body:JSON.stringify({status:'delivered'})})}catch(error){console.error(`Failed to mark message ${m.id} as delivered`,error)}}));
 },[me?.id]);
 const syncConversation=useCallback(async (conversationId:number)=>{
  try{
   const latest:Message[]=await api(`/api/conversations/${conversationId}/messages`);
   if(selectedRef.current!==conversationId)return;
   setMessages(old=>{
    const merged=latest.map(server=>{const current=old.find(m=>m.client_id===server.client_id);return current?{...server,status:advanceStatus(current.status,server.status)}:server});
    return [...merged,...old.filter(m=>m.id<0&&!latest.some(server=>server.client_id===m.client_id))];
   });
   void markMessagesRead(conversationId,latest);
  }catch(error){console.error(`Failed to sync conversation ${conversationId}`,error)}
 },[markMessagesRead]);
 async function retryPendingMessages(){
  const pending=messagesRef.current.filter(message=>message.id<0&&message.status==='sending');
  for(const message of pending){
   try{
    const result=await api(`/api/conversations/${message.conversation_id}/messages`,{method:'POST',body:JSON.stringify({client_id:message.client_id,content:message.content})});
    setMessages(old=>old.map(current=>current.client_id===message.client_id?{...current,id:result.id,status:advanceStatus(current.status,result.status||'sent')}:current));
   }catch(error){console.error(`Failed to retry message ${message.client_id}`,error)}
  }
 }
 useEffect(()=>{if(!token())return;api('/api/me').then(setMe).catch(()=>localStorage.removeItem('signal_token'))},[]);
 useEffect(()=>{
  if(!me)return;
  let disposed=false;let retryTimer:ReturnType<typeof setTimeout>|undefined;let retryDelay=1000;let ws:WebSocket|null=null;
  void api('/api/conversations').then((rows:Conversation[])=>{if(!disposed)setConvos(rows)}).catch(error=>console.error('Failed to load conversations',error));
  const connect=()=>{
   if(disposed)return;
   const connection=new WebSocket(`${WS}/ws/${me.id}?token=${token()}`);ws=connection;socket.current=connection;
   connection.onopen=()=>{retryDelay=1000;void retryPendingMessages();if(selectedRef.current)void syncConversation(selectedRef.current)};
   connection.onmessage=e=>{
    const d=JSON.parse(e.data);
    if(d.type==='message.new'){
     const message=d.message as Message;
     const conversationVisible=message.conversation_id===selectedRef.current&&(mobileChatRef.current||window.matchMedia('(min-width: 768px)').matches);
     if(conversationVisible){
      setMessages(old=>{const existing=old.find(m=>m.client_id===message.client_id);return existing?old.map(m=>m.client_id===message.client_id?{...m,...message,status:advanceStatus(m.status,message.status)}:m):[...old,message]});
      if(message.sender_id!==me.id)void markMessagesRead(message.conversation_id,[message]);
     }else{
      void markMessagesDelivered([message]);
     }
     void refresh().catch(error=>console.error('Failed to refresh conversations',error));
    }
    if(d.type==='receipt.update')setMessages(old=>old.map(m=>m.id===d.message_id?{...m,status:advanceStatus(m.status,d.status)}:m));
    if(d.type==='typing.start'&&d.conversation_id===selectedRef.current)setTyping(true);
    if(d.type==='typing.stop'&&d.conversation_id===selectedRef.current)setTyping(false);
   };
   connection.onclose=()=>{if(socket.current===connection)socket.current=null;if(!disposed){setTyping(false);retryTimer=setTimeout(connect,retryDelay);retryDelay=Math.min(retryDelay*2,30000)}};
   connection.onerror=()=>connection.close();
  };
  connect();
  return()=>{disposed=true;if(retryTimer)clearTimeout(retryTimer);if(socket.current===ws)socket.current=null;ws?.close()};
 },[me,markMessagesDelivered,markMessagesRead,syncConversation]);
 useEffect(()=>{
  if(!selected)return;
  let cancelled=false;
  api(`/api/conversations/${selected}/messages`).then((rows:Message[])=>{if(!cancelled){setMessages(rows);void markMessagesRead(selected,rows)}}).catch(error=>console.error(`Failed to load messages for conversation ${selected}`,error));
  return()=>{cancelled=true};
 },[selected,markMessagesRead]);
 useEffect(()=>{endRef.current?.scrollIntoView({behavior:'smooth'})},[messages]);
 const filtered=useMemo(()=>convos.filter(c=>c.title.toLowerCase().includes(query.toLowerCase())),[convos,query]);
 async function openUser(u:User){const c=await api(`/api/conversations/direct/${u.id}`,{method:'POST'});await refresh();if(selected!==c.id)setMessages([]);setSelected(c.id);setShowNew(false);setMobileChat(true)}
 async function send(){if(!draft.trim()||!selected)return;const content=draft.trim();setDraft('');const client_id=crypto.randomUUID();const optimistic:Message={id:-Date.now(),client_id,conversation_id:selected,sender_id:me!.id,content,created_at:new Date().toISOString(),status:'sending'};setMessages(old=>[...old,optimistic]);try{const result=await api(`/api/conversations/${selected}/messages`,{method:'POST',body:JSON.stringify({client_id,content})});setMessages(old=>old.map(m=>m.client_id===client_id?{...m,id:result.id,status:advanceStatus(m.status,result.status||'sent')}:m));await refresh()}catch(error){console.error('Message remains queued and will retry after reconnect',error)}}
 function typingEvent(value:string){setDraft(value);const connection=socket.current;if(!selected||!connection||connection.readyState!==WebSocket.OPEN)return;connection.send(JSON.stringify({type:'typing.start',conversation_id:selected}));if(typingTimer.current)clearTimeout(typingTimer.current);typingTimer.current=setTimeout(()=>{const activeSocket=socket.current;if(activeSocket?.readyState===WebSocket.OPEN)activeSocket.send(JSON.stringify({type:'typing.stop',conversation_id:selected}));typingTimer.current=null},1200)}
 async function searchUsers(q:string){setQuery(q);if(q.trim())setUsers(await api(`/api/users?q=${encodeURIComponent(q)}`))}
 async function logout(){await api('/api/auth/logout',{method:'POST'}).catch(()=>{});localStorage.removeItem('signal_token');setMe(null);setConvos([]);setSelected(null);setMessages([])}
 if(!me)return <Auth onLogin={setMe}/>;
 const other=active?.members.find(u=>u.id!==me.id);
 return <main className="messenger-shell h-screen w-screen overflow-hidden bg-white flex text-[#292d32]">
  <aside className={`conversation-sidebar ${mobileChat?'hidden':'flex'} md:flex w-full md:w-[390px] shrink-0 border-r border-[#e8eaed] flex-col`}>
   <div className="h-[68px] px-5 flex items-center justify-between border-b border-[#eff0f2]"><div className="flex items-center gap-3"><div className="h-9 w-9 rounded-xl bg-[#3a76e8] text-white font-bold flex items-center justify-center">S</div><span className="font-semibold text-[19px]">Signal</span></div><div className="flex gap-2"><button onClick={()=>setShowNew(true)} className="p-2 hover:bg-slate-100 rounded-full" title="New message"><Plus size={20}/></button><button onClick={()=>setShowSettings(true)} className="p-2 hover:bg-slate-100 rounded-full" title="Settings"><Settings size={19}/></button></div></div>
   <div className="p-4 pb-2"><div className="flex items-center gap-2 bg-[#f1f3f5] rounded-xl px-3 h-10"><Search size={17} className="text-slate-500"/><input value={query} onChange={e=>searchUsers(e.target.value)} placeholder="Search" className="bg-transparent outline-none text-sm w-full"/></div><div className="flex gap-2 mt-3 text-xs"><button className="rounded-full bg-[#eaf1ff] text-[#316ed8] px-3 py-1.5">All chats</button><button className="rounded-full hover:bg-slate-100 px-3 py-1.5 text-slate-500">Unread</button><button className="rounded-full hover:bg-slate-100 px-3 py-1.5 text-slate-500">Groups</button></div></div>
   <div className="flex-1 overflow-y-auto">{query&&users.length>0&&<div className="px-4 pt-2 text-xs text-slate-400 uppercase">People</div>}{query&&users.map(u=><button key={u.id} onClick={()=>openUser(u)} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-50 text-left"><Avatar name={u.display_name}/><div><div className="font-medium text-sm">{u.display_name}</div><div className="text-xs text-slate-500">@{u.username}</div></div></button>)}{filtered.map(c=><button key={c.id} onClick={()=>{if(selected!==c.id)setMessages([]);setSelected(c.id);setMobileChat(true)}} className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-[#f7f8fa] ${selected===c.id?'bg-[#f0f4fa]':''}`}><Avatar name={c.title} online={c.members.some(m=>m.id!==me.id&&m.is_online)}/><div className="min-w-0 flex-1 border-b border-[#f0f1f2] pb-3"><div className="flex justify-between gap-2"><span className="font-medium text-[14px] truncate">{c.title}</span><span className="text-[11px] text-slate-400">{c.last_message?new Date(c.last_message.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):''}</span></div><div className="text-[13px] text-slate-500 truncate mt-1">{c.last_message?(c.last_message.sender_id===me.id?'You: ':'')+c.last_message.content:'Start a conversation'}</div></div></button>)}</div>
   <div className="border-t border-[#eff0f2] p-3 flex items-center gap-3"><Avatar name={me.display_name} size={36}/><div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{me.display_name}</div><div className="text-xs text-slate-400">Available</div></div><button onClick={logout} className="p-2 text-slate-500 hover:bg-slate-100 rounded-full" title="Sign out"><LogOut size={17}/></button></div>
  </aside>
  <section className={`chat-panel ${mobileChat?'flex':'hidden'} md:flex flex-1 min-w-0 flex-col bg-white`}>
   {active?<><header className="h-[68px] border-b border-[#eff0f2] flex items-center px-5 gap-3"><button className="md:hidden p-1" onClick={()=>setMobileChat(false)}><ArrowLeft/></button><Avatar name={active.title} size={40} online={!!other?.is_online}/><div className="flex-1"><div className="font-semibold text-[15px]">{active.title}</div><div className="text-xs text-slate-500">{active.type==='group'?`${active.members.length} members`:other?.is_online?'online':'last seen recently'}</div></div><button className="p-2 hover:bg-slate-100 rounded-full text-slate-500" title="Voice call (coming soon)"><Phone size={19}/></button><button className="p-2 hover:bg-slate-100 rounded-full text-slate-500" title="Video call (coming soon)"><Video size={19}/></button><button className="p-2 hover:bg-slate-100 rounded-full text-slate-500"><MoreVertical size={19}/></button></header>
   <div className="flex-1 overflow-y-auto px-5 md:px-12 py-6 bg-[#fff]"><div className="max-w-[850px] mx-auto flex flex-col gap-2">{messages.map(m=><div key={m.client_id||m.id} className={`flex ${m.sender_id===me.id?'justify-end':'justify-start'}`}><div className={`max-w-[75%] md:max-w-[65%] rounded-2xl px-4 py-2.5 shadow-[0_1px_1px_rgba(0,0,0,.04)] ${m.sender_id===me.id?'bg-[#dce9ff] rounded-br-md':'bg-[#f1f2f4] rounded-bl-md'}`}><div className="text-[14px] leading-[1.5] whitespace-pre-wrap break-words">{m.content}</div><div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-slate-400">{new Date(m.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}{m.sender_id===me.id&&(m.status==='sending'?<Clock3 size={13} aria-label="Sending"/>:m.status==='sent'?<Check size={13} className="text-slate-400" aria-label="Sent"/>:<CheckCheck size={13} className={m.status==='read'?'text-[#3c78df]':'text-slate-400'} aria-label={m.status==='read'?'Read':'Delivered'}/>)}</div></div></div>)}{typing&&<div className="text-xs text-slate-400 px-2">Someone is typing…</div>}<div ref={endRef}/></div></div>
   <div className="px-5 md:px-10 py-4"><div className="max-w-[850px] mx-auto flex items-end gap-2 rounded-2xl border border-[#e6e8eb] px-3 py-2 shadow-sm"><button className="p-2 text-slate-400 hover:text-slate-600" title="Attachments (coming soon)"><Paperclip size={20}/></button><textarea value={draft} onChange={e=>typingEvent(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}} placeholder="Write a message…" rows={1} className="flex-1 resize-none outline-none text-sm py-2 max-h-32 bg-transparent"/><button className="p-2 text-slate-400 hover:text-slate-600"><Smile size={20}/></button><button onClick={send} disabled={!draft.trim()} className="h-9 w-9 rounded-full bg-[#3a76e8] text-white flex items-center justify-center disabled:opacity-40"><Send size={17}/></button></div><div className="text-center text-[10px] text-slate-400 mt-2 flex items-center justify-center gap-1"><ShieldCheck size={11}/> Messages are stored in this demo. End-to-end encryption is not implemented.</div></div>
   </>:<div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400"><div className="h-20 w-20 rounded-3xl bg-[#edf3ff] text-[#3a76e8] flex items-center justify-center mb-5"><MessageSquare size={34}/></div><h2 className="text-xl text-slate-700 font-medium">Signal</h2><p className="text-sm mt-2 max-w-xs">Select a conversation or start a new message to connect with people.</p><p className="text-xs mt-8">Private messaging, made simple.</p></div>}
  </section>
  {showNew&&<div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-20" onClick={()=>setShowNew(false)}><div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5" onClick={e=>e.stopPropagation()}><div className="flex justify-between items-center mb-4"><h3 className="font-semibold text-lg">New message</h3><button onClick={()=>setShowNew(false)}><X/></button></div><div className="flex items-center gap-2 bg-slate-100 rounded-lg p-3"><Search size={17}/><input autoFocus value={query} onChange={e=>searchUsers(e.target.value)} placeholder="Search by name or username" className="bg-transparent outline-none flex-1 text-sm"/></div><div className="mt-3 max-h-72 overflow-auto">{users.map(u=><button key={u.id} onClick={()=>openUser(u)} className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 rounded-lg text-left"><Avatar name={u.display_name}/><div><div className="text-sm font-medium">{u.display_name}</div><div className="text-xs text-slate-400">@{u.username}</div></div></button>)}</div></div></div>}
  {showSettings&&<div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-20" onClick={()=>setShowSettings(false)}><div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e=>e.stopPropagation()}><div className="flex justify-between mb-5"><h3 className="font-semibold text-lg">Settings</h3><button onClick={()=>setShowSettings(false)}><X/></button></div><div className="flex items-center gap-3 pb-5 border-b"><Avatar name={me.display_name} size={52}/><div><div className="font-medium">{me.display_name}</div><div className="text-sm text-slate-500">@{me.username}</div></div></div><div className="py-4 space-y-4 text-sm"><div className="flex gap-3 items-center"><ShieldCheck className="text-slate-500"/> Privacy <span className="ml-auto text-xs text-slate-400">Coming soon</span></div><div className="flex gap-3 items-center"><Settings className="text-slate-500"/> Notifications <span className="ml-auto text-xs text-slate-400">Coming soon</span></div><div className="flex gap-3 items-center"><Moon className="text-slate-500"/> Appearance <span className="ml-auto text-xs text-slate-400">Light</span></div><div className="flex gap-3 items-center"><Users className="text-slate-500"/> Linked devices <span className="ml-auto text-xs text-slate-400">Coming soon</span></div></div><button onClick={logout} className="w-full border rounded-lg p-2.5 text-sm mt-2">Sign out</button></div></div>}
 </main>
}
