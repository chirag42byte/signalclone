# Signal – Real-Time Messaging Application

A full-stack messaging application inspired by Signal, built using Next.js, React, FastAPI, WebSockets, and PostgreSQL.

The application supports user authentication, one-to-one messaging, group conversations, real-time communication, and persistent message storage.

## Live Demo

| Component | Link |
|---|---|
| **Live Application** | https://signalclone-mu.vercel.app/ |
| Backend API | https://signal-clone-api-s88a.onrender.com/ |
| API Documentation | https://signal-clone-api-s88a.onrender.com/docs |
| GitHub Repository | https://github.com/chirag42byte/signalclone |

**Important:** The backend runs on Render's free tier. If inactive, it may spin down. The first request after inactivity can take approximately 50 seconds or more to respond. Please allow the application some time to initialize.

---

# 1. Testing the Live Demo

The application can be tested directly through the deployed link. No installation or local configuration is required.

**Recommended:** Use two or three separate browser sessions to test communication between multiple users.

## Test 1: User Registration

1. Open the [Live Application](https://signalclone-mu.vercel.app/).
2. Navigate to the registration/sign-up page.
3. Enter the following details:
   - Display Name
   - Username
   - Password
   - Phone Number (if requested)
4. Submit the registration form.
5. You should be automatically logged in and redirected to the messaging interface.

Create at least two accounts with different usernames to test messaging.

Each username must be unique.

## Test 2: User Login

1. Open the application in another browser or an Incognito window.
2. Navigate to the login page.
3. Enter the credentials of the second account.
4. Click Login.
5. Verify that the second user is redirected to their messaging interface.

You should now have two independently authenticated users.

## Test 3: One-to-One Messaging

Use the two accounts created previously.

**User A:**
1. Open the application in your primary browser.
2. Navigate to the user search or contacts section.
3. Search for User B using their username.
4. Select User B and open a conversation.

**User B:**
1. Keep the second browser session open.
2. Wait for the incoming conversation or notification.

Now send messages between both users.

Verify the following:

- Messages sent by User A appear in User B's conversation.
- Messages sent by User B appear in User A's conversation.
- Messages are delivered without manually refreshing the browser.
- Messages appear in the correct conversation.
- Message timestamps are displayed correctly.

## Test 4: Real-Time Communication

This test verifies the WebSocket implementation.

1. Keep both users logged in simultaneously.
2. Open the same conversation from both accounts.
3. Send a message from User A.
4. Observe User B's screen.

**Expected result:** The message should appear on User B's screen without requiring a page refresh.

Repeat the same test in the opposite direction.

This verifies bidirectional real-time communication.

## Test 5: Message Persistence

This test verifies that messages are stored in the database.

1. Exchange several messages between User A and User B.
2. Refresh User B's browser.
3. Open the conversation again.
4. Verify that previous messages are still available.
5. Log out of User B's account.
6. Log back in using the same credentials.
7. Open the conversation again.

**Expected result:** Previously exchanged messages should remain available after refreshing and logging back in.

## Test 6: Group Messaging

Use three independently registered accounts.

1. Log in as User A.
2. Navigate to the group creation option.
3. Enter a group name.
4. Search for and select User B and User C.
5. Create the group.
6. Verify that the group appears in the conversation list.

Now test group communication:

1. Send a message from User A.
2. Verify that User B and User C receive the message.
3. Reply from User B.
4. Verify that User A and User C receive the reply.
5. Send another message from User C.
6. Verify that all group members receive it.

**Expected result:** All group members should be able to exchange messages in real time, and group messages should remain available after refreshing the application.

## Test 7: Authentication and Session Handling

1. Log in using a registered account.
2. Verify that authenticated sections are accessible.
3. Log out.
4. Attempt to access an authenticated section again.
5. Verify that the application requires authentication.
6. Log in again and verify that the previous conversations are accessible.

---

# 2. Features

### Authentication
- User registration and login.
- Secure password hashing.
- JWT-based authentication.
- Authenticated API requests.

### One-to-One Messaging
- Direct conversations between users.
- Real-time message delivery using WebSockets.
- Persistent message history.
- Message delivery and read receipts.
- Duplicate message prevention using client-generated message IDs.

### Group Messaging
- Create group conversations.
- Add multiple participants during group creation.
- Group-based message broadcasting.
- Persistent group conversations.
- Multiple users communicating simultaneously.

### User Management
- Search registered users.
- Add users to contacts.
- Online/offline presence.
- Last-seen information.

### Messaging Interface
- Conversation sidebar.
- Message previews and timestamps.
- Responsive interface.
- Real-time conversation updates.

---

# 3. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js, React, TypeScript |
| Backend | Python, FastAPI |
| Database | PostgreSQL |
| ORM | SQLAlchemy |
| Authentication | JWT |
| Real-time Communication | WebSockets |
| Frontend Hosting | Vercel |
| Backend Hosting | Render |

---

# 4. Architecture

The application follows a decoupled client-server architecture.

```text
             Users / Browsers
                    |
                    v
             Next.js Frontend
                  Vercel
                    |
             HTTP / REST API
                    |
                    v
              FastAPI Backend
                  Render
                    |
           +--------+--------+
           |                 |
           v                 v
       WebSockets         PostgreSQL
       Real-time          Persistent
       Messaging           Storage
```

- REST APIs handle authentication, user management, contacts, and conversation operations.
- WebSockets provide bidirectional communication for real-time messaging and typing events.
- PostgreSQL stores users, conversations, memberships, messages, and message receipts.
- JWT tokens authenticate users and authorize protected operations.

---

# 5. Local Development Setup

### Prerequisites

- Python 3.12+
- Node.js and npm
- PostgreSQL
- Git

### Step 1: Clone the repository

```bash
git clone https://github.com/chirag42byte/signalclone.git
cd signalclone
```

### Step 2: Backend Setup

```bash
cd backend

python -m venv venv
```

Activate the environment.

**Windows:**

```powershell
venv\Scripts\activate
```

**Linux/macOS:**

```bash
source venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Create a `.env` file inside the backend directory:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/signalclone

SECRET_KEY=your_secure_secret_key

CORS_ORIGINS=http://localhost:3000
```

Start the backend:

```bash
uvicorn app.main:app --reload --port 8000
```

Backend URL:

http://localhost:8000

API documentation:

http://localhost:8000/docs

### Step 3: Frontend Setup

Open another terminal:

```bash
cd frontend

npm install
```

Create a `.env.local` file inside the frontend directory:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000

NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

Start the frontend:

```bash
npm run dev
```

Open:

http://localhost:3000

---

# 6. API Documentation

The backend exposes interactive API documentation through Swagger UI.

**[Explore the API Documentation](https://signal-clone-api-s88a.onrender.com/docs)**

Important API endpoints include:

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Register a user |
| POST | `/api/auth/login` | Authenticate a user |
| POST | `/api/auth/logout` | Log out |
| GET | `/api/me` | Retrieve current user |
| GET | `/api/users` | Search users |
| POST | `/api/contacts` | Add a contact |
| GET | `/api/contacts` | Retrieve contacts |
| POST | `/api/conversations/direct/{other_id}` | Create/open direct conversation |
| POST | `/api/conversations/group` | Create a group |
| GET | `/api/conversations` | Retrieve conversations |
| GET | `/api/conversations/{conversation_id}/messages` | Retrieve message history |
| POST | `/api/conversations/{conversation_id}/messages` | Send a message |
| POST | `/api/messages/{message_id}/receipt` | Update message receipt |

WebSocket endpoint:

```text
/ws/{user_id}?token={jwt_token}
```

---

# 7. Environment Variables

### Backend

| Variable | Description |
|---|---|
| DATABASE_URL | PostgreSQL connection string |
| SECRET_KEY | JWT signing secret |
| CORS_ORIGINS | Allowed frontend origins |

### Frontend

| Variable | Description |
|---|---|
| NEXT_PUBLIC_API_URL | Backend HTTP API URL |
| NEXT_PUBLIC_WS_URL | Backend WebSocket URL |

Never commit environment files, database credentials, or JWT secrets to GitHub.

---

# 8. Project Structure

```text
signalclone/
│
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── schemas.py
│   │   ├── database.py
│   │   ├── security.py
│   │   └── realtime.py
│   │
│   └── requirements.txt
│
├── frontend/
│   ├── app/
│   ├── package.json
│   └── ...
│
├── render.yaml
├── README.md
└── ...
```

---

# 9. Future Improvements

- End-to-end encryption.
- File and media sharing.
- Push notifications.
- Message reactions.
- Improved message pagination and search.
- Enhanced group administration.

---

# Author

**Chirag Bali**

GitHub: https://github.com/chirag42byte

Built as a full-stack real-time messaging application to explore backend engineering, REST API development, WebSockets, authentication, database management, and cloud deployment.
