# Employee Management System (EMS) — MERN Stack

A complete, production-ready Employee Management System with separate **Admin** and **Employee** dashboards, JWT authentication, role-based access control, and a polished HR-software interface.

Built with React, Node.js/Express, and MongoDB.

---

## ✨ Features

### Authentication & Security
- JWT-based authentication with signed tokens (verified on every request)
- Password hashing with bcrypt (salt rounds: 12)
- Role-based access control: Admin, HR, Manager, Employee
- Protected frontend routes with route guards
- Backend authorization middleware on every protected endpoint
- Account activation/deactivation
- Change password functionality
- Persistent login (7-day JWT expiry)
- Rate limiting on auth endpoints (20 attempts / 15 min)
- Secure HTTP headers (Helmet)
- CORS configured explicitly
- Initial Admin created through a one-time server-key-protected setup or secure CLI seed

### Admin Dashboard
- Real-time metrics: total employees, present/absent today, pending leave, department-wise stats
- Attendance trend chart (last 7 days)
- Employee management: add, list (paginated), search, filter, edit, activate/deactivate
- Department management: create, edit, delete (with employee-reference safety check)
- Attendance management: daily list, monthly reports, check-in/out, admin correction with audit trail, CSV export
- Leave management: approve/reject with reasons, balance tracking, overlap prevention, self-approval blocked
- Reports: employee, attendance, leave, department-wise summaries with CSV export
- Payroll generation and approval
- Financial records preserve their stored amounts and currency; legacy records without currency metadata are marked `UNVERIFIED` at startup, never converted automatically, and require verification before payroll calculation
- Employee onboarding documents are served only through authenticated, role- and team-authorized downloads
- Performance reviews
- Task management (assign tasks to employees)
- Notifications

### Employee Dashboard
- Personal profile (edit permitted fields only)
- Check-in / check-out with working-hours calculation
- Attendance history with calendar view and monthly summaries
- Apply for leave with balance validation and overlap detection
- Cancel pending leave requests
- View leave balances and request status
- View payslips and performance reviews
- Read notifications
- Data isolation enforced on the backend (employees only access their own records)

### EMS Assistant
- Shared assistant with page-aware prompts, searchable verified knowledge articles, and role-scoped answers from attendance, leave, payroll, approvals, and assigned-team records
- Answers cite their EMS record or verified knowledge source; unsupported questions are identified as unverified rather than presented as resolved
- Feedback is saved for Admin analytics; feedback never changes company policy automatically
- Support tickets require user confirmation, retain status/comment/assignment history, and notify authorized Admin/HR users and the requester
- Admin manages verified articles, feedback analytics, ticket assignment, and status; authorized HR users manage tickets
- Assistant endpoints enforce role permissions and onboarding gates on the backend; employee live-data access remains self-scoped
- Retrieval is performed in the EMS backend; no third-party AI provider or external data transfer is configured

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 (Create React App) |
| Styling | Custom CSS design system (Inter font, CSS variables) |
| Routing | React Router v6 |
| HTTP | Axios |
| Charts | Recharts |
| Notifications | react-hot-toast |
| Icons | lucide-react |
| Backend | Node.js + Express |
| Database | MongoDB + Mongoose |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Security | Helmet, express-rate-limit, CORS |

---

## 📁 Project Structure

```
employee-management-system/
├── backend/
│   ├── config/
│   │   └── db.js                  # MongoDB connection
│   ├── controllers/
│   │   ├── authController.js      # Login, register, profile, password
│   │   ├── employeeController.js  # Employee CRUD + status toggle
│   │   ├── departmentController.js
│   │   ├── attendanceController.js
│   │   ├── leaveController.js     # Apply, approve, cancel, balances
│   │   ├── taskController.js
│   │   ├── reportController.js    # Dashboard metrics + CSV exports
│   │   ├── payrollController.js
│   │   ├── performanceController.js
│   │   └── notificationController.js
│   ├── middleware/
│   │   ├── auth.js                # JWT verification + role checks
│   │   ├── errorHandler.js        # Centralized error handling
│   │   └── rateLimiter.js          # Auth + API rate limits
│   ├── models/
│   │   ├── User.js                # With bcrypt pre-save hook
│   │   ├── Employee.js
│   │   ├── Department.js
│   │   ├── Attendance.js           # With correction audit trail
│   │   ├── Leave.js
│   │   ├── Task.js
│   │   ├── Payroll.js
│   │   ├── Performance.js
│   │   └── Notification.js
│   ├── routes/
│   │   └── *.js                   # Express routers
│   ├── scripts/
│   │   └── seed.js                # Initial admin + departments seed
│   ├── .env.example
│   ├── package.json
│   └── server.js
│
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── layout/             # AppLayout, Sidebar, Header
    │   │   ├── employee/           # EmployeeLayout, EmployeeSidebar
    │   │   └── shared/             # Avatar, Badge, Modal, Pagination, Skeleton
    │   ├── context/
    │   │   ├── AuthContext.js      # Auth state + login/logout
    │   │   └── AppContext.js       # Data state + API calls
    │   ├── services/
    │   │   └── api.js              # Axios instance + API modules
    │   ├── utils/
    │   │   └── currency.js         # INR/USD formatting and unverified legacy amounts
    │   ├── data/
    │   │   └── sampleData.js       # Leave types, reference data
    │   ├── pages/
    │   │   ├── auth/               # Login, Register, Forgot/Reset Password
    │   │   ├── employees/          # List, Add/Edit, Profile
    │   │   ├── departments/        # Departments, Roles
    │   │   ├── attendance/         # Daily, History, Reports
    │   │   ├── leave/              # Requests, Apply, Approval, Balance
    │   │   ├── payroll/            # Salary, Generate, History, Payslips
    │   │   ├── performance/        # Reviews, Goals
    │   │   ├── employee/           # Employee portal pages
    │   │   ├── Dashboard.js
    │   │   ├── Reports.js
    │   │   ├── Settings.js
    │   │   └── Unauthorized.js
    │   ├── App.js                  # Routes + guards
    │   ├── index.js
    │   └── index.css              # Design system
    ├── .env
    └── package.json
```

---

## 🚀 Local Setup

### Prerequisites
- Node.js 16+
- MongoDB replica set (local single-node replica set or MongoDB Atlas free tier)

### 1. Clone & install

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Configure environment

**Backend** — copy `.env.example` to `.env`:

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env`:
```env
MONGO_URI=mongodb://127.0.0.1:27017/employee_management_system?replicaSet=rs0
PORT=5000
JWT_SECRET=generate_a_random_64_char_secret_here
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:3000
INITIAL_ADMIN_SETUP_KEY=<unique random secret of at least 32 characters>
```

Generate a JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Use the generated value as `INITIAL_ADMIN_SETUP_KEY`, restart the backend, then open
`/setup` to create the first Admin. The setup endpoint is disabled when an Admin
already exists. Public registration is Employee-only and remains locked until an
Admin approves the registration. Stage 2 profile and document approval is required
before Employee Portal modules are available. Never commit the setup key or other
server secrets.

Registration approval uses MongoDB transactions. For local MongoDB, start `mongod`
with `--replSet rs0` and run `rs.initiate()` once in `mongosh`; include
`?replicaSet=rs0` in `MONGO_URI`. MongoDB Atlas is already transaction-capable.

**Frontend** — `frontend/.env` is preconfigured:
```env
REACT_APP_API_URL=http://localhost:5000/api
```

### 3. Seed the initial admin

```bash
cd backend
npm run seed
```

This creates:
- An admin account: `admin@company.com` / `Admin@123456`
- 8 default departments (Engineering, HR, Marketing, Sales, Finance, Operations, Design, Legal)

### 4. Start the servers

**Backend** (terminal 1):
```bash
cd backend
npm run dev
```
Runs on `http://localhost:5000` with Nodemon auto-reload.

**Frontend** (terminal 2):
```bash
cd frontend
npm start
```
Runs on `http://localhost:3000`.

### 5. Log in

Open `http://localhost:3000` and log in with:
- **Email:** `admin@company.com`
- **Password:** `Admin@123456`

Change the password after first login from Settings → My Profile.

---

## 🔌 API Documentation

Base URL: `http://localhost:5000/api`

All protected routes require `Authorization: Bearer <JWT>` header.

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/auth/setup/status` | — | Check whether one-time Initial Admin setup is enabled |
| POST | `/auth/setup/admin` | Setup key | Create the first Admin only |
| POST | `/auth/register` | — | Submit Employee registration for Stage 1 Admin approval |
| GET | `/auth/registrations` | Admin | List Stage 1 registrations and Stage 2 profile reviews |
| PATCH | `/auth/registrations/:id/review` | Admin | Approve/reject registration and link the verified Employee profile |
| GET/PUT/POST | `/auth/onboarding` | Employee | Resume/save onboarding draft and submit Stage 2 profile/documents |
| PATCH | `/auth/onboarding/reviews/:id` | Admin | Verify submitted profile/documents or request corrections |
| GET | `/auth/onboarding/documents/:userId/:documentId` | Admin | Download a submitted onboarding document |
| POST | `/auth/profile-correction` | Employee | Request a correction to an approved profile |
| POST | `/auth/login` | — | Login, returns JWT |
| POST | `/auth/google` | — | Google OAuth sign-in |
| GET | `/auth/me` | Any | Get current user |
| PUT | `/auth/me` | Any | Update profile |
| PUT | `/auth/change-password` | Any | Change password |
| GET | `/auth/users` | Admin/HR | List all users |
| PUT | `/auth/users/:id/status` | Admin/HR | Activate/deactivate user |

### Employees
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/employees?page=&limit=&search=&department=&status=` | Any | List (paginated, filtered) |
| GET | `/employees/:id` | Any (owner only for Employee) | Get one |
| GET | `/employees/me` | Any | Current user's linked record |
| POST | `/employees` | Admin/HR | Create (auto-generates EMP-0001 ID) |
| PUT | `/employees/:id` | Admin/HR | Update |
| PATCH | `/employees/:id/status` | Admin/HR | Activate/deactivate |
| DELETE | `/employees/:id` | Admin/HR | Delete |

### Departments
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/departments` | Any | List with employee counts |
| POST | `/departments` | Admin/HR | Create |
| PUT | `/departments/:id` | Admin/HR | Update (renames propagate to employees) |
| DELETE | `/departments/:id` | Admin/HR | Delete (blocked if employees assigned) |

### Attendance
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/attendance?date=&month=&employeeId=` | Any (scoped) | List |
| POST | `/attendance` | Admin/HR | Mark attendance |
| POST | `/attendance/self` | Any | Self-mark |
| POST | `/attendance/check-in` | Any | Check in (blocks duplicates) |
| PUT | `/attendance/check-out` | Any | Check out (calculates hours) |
| PUT | `/attendance/:id/correct` | Admin/HR | Correct with audit trail |
| GET | `/attendance/my-summary?month=YYYY-MM` | Any | Monthly summary |

### Leave
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/leave?status=&employeeId=` | Any (scoped) | List |
| GET | `/leave/balance` | Any | Leave balances |
| POST | `/leave` | Any | Apply (validates overlaps + balance) |
| PUT | `/leave/:id/status` | Admin/HR | Approve/reject (blocks self-approval) |
| PUT | `/leave/:id/cancel` | Any (owner) | Cancel pending request |

### Tasks
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/tasks?status=&userId=` | Any (scoped) | List |
| POST | `/tasks` | Admin/HR | Assign |
| PUT | `/tasks/:id` | Any (employees: status only) | Update |
| DELETE | `/tasks/:id` | Admin/HR | Delete |

### Reports (CSV export via `?format=csv`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/reports/dashboard` | Any | Aggregated metrics |
| GET | `/reports/attendance?from=&to=&format=csv` | Any (scoped) | Attendance report |
| GET | `/reports/leave?from=&to=&status=&format=csv` | Any (scoped) | Leave report |
| GET | `/reports/employees?department=&status=&format=csv` | Admin/HR | Employee report |
| GET | `/reports/departments` | Admin/HR | Department summary |

### Notifications
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/notifications` | Any | List own notifications |
| PUT | `/notifications/:id/read` | Any | Mark read |
| PUT | `/notifications/read-all` | Any | Mark all read |
| DELETE | `/notifications/:id` | Any | Delete |

---

## 🔑 Google Sign-In Setup

Google Sign-In is optional. Email/password login and employee registration continue to work when Google OAuth is not configured. Login and registration use the same Google Identity Services authorization-code flow.

### Step 1 — Create a Google OAuth 2.0 Client ID

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. Click **Create Credentials → OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Name it anything (e.g. `EMS Local`)
5. Under **Authorized JavaScript origins** add:
   - `http://localhost:3000` (local dev)
   - `https://yourdomain.com` (production, when ready)
6. Under **Authorized redirect URIs**, add the same exact origins. The popup code flow exchanges the code using the calling page's origin as `redirect_uri`.
7. Click **Create** — copy the **Client ID** and **Client Secret**.

> Keep the **Client Secret** server-side only. Never add it to the frontend or commit it.

### Step 2 — Configure the client

Copy [frontend/.env.example](./frontend/.env.example) to `frontend/.env` and set:
```env
REACT_APP_GOOGLE_CLIENT_ID=xxxxxxxxxx.apps.googleusercontent.com
```

Set these in `backend/.env`:
```env
GOOGLE_CLIENT_ID=xxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret
CORS_ORIGIN=http://localhost:3000
```

The frontend and backend Client IDs must match. Set `CORS_ORIGIN` to the comma-separated frontend origins in each environment; the origin must also be registered in Google Cloud.

### Step 3 — Restart the dev server

After editing `frontend/.env`, restart the frontend:
```bash
# Stop the current npm start, then:
cd frontend
npm start
```

The backend does not need a restart (dotenv reads at startup — restart if you changed `backend/.env` while it was running).

### How it works (security model)

```
Browser (React)                 Backend (Express)             Google Servers
──────────────────────────────  ────────────────────────────  ─────────────────
User clicks Google button       Google popup with             Account selection
`prompt=select_account`         `openid email profile`        and consent
Popup returns one-time code →   POST /api/auth/google
                                custom CSRF header + Origin
                                exchanges code and verifies
                                signed ID token ←──────────── Google token endpoint
                                links or submits Employee
                                registration for approval
```

The frontend sends only Google's short-lived authorization code. The backend verifies the request origin and CSRF header, exchanges the code using the server-only client secret, verifies the signed ID token and verified email, and then applies the existing account approval and onboarding gates. Google access and refresh tokens are not persisted.

### Error handling

| Scenario | Response |
|----------|----------|
| Google client ID or secret is not configured | 503 — Google sign-in unavailable |
| Invalid/expired authorization code or ID token | 401 — retry account selection |
| Unverified Google email | 403 — verified email required |
| Registration pending | 202 — confirmed, but no session or portal access |
| Rejected or suspended account | 403 — contact an administrator |
| Email linked to another Google subject | 409 — sign in with the linked account |
| Popup blocked or cancelled | Clear inline message; email/password remains available |

### Production deployment

1. Add the exact production frontend origin to **Authorized JavaScript origins** in Google Cloud Console.
2. Set `REACT_APP_GOOGLE_CLIENT_ID` in the frontend build environment.
3. Set matching `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `CORS_ORIGIN` in the backend environment.
4. Rebuild and deploy the frontend and restart the backend.

### Company logo and favicon

No company-provided image/logo or favicon asset is present in `frontend/public` or `frontend/src`. The shield placeholders and broken favicon reference have been removed rather than replaced with an invented logo. Provide the official logo asset before adding it to the login/signup branding, application navigation, and favicon.

---

## 🔒 Security Implementation

- **Password hashing:** bcrypt with 12 salt rounds, pre-save Mongoose hook
- **JWT:** Signed with `JWT_SECRET`, 7-day expiry, signature verified on every request
- **Token storage:** localStorage with Authorization Bearer header
- **Expired tokens:** 401 response triggers automatic logout on the frontend
- **Role enforcement:** `protect` (any authenticated) and `adminOnly` (Admin/HR) middleware
- **Data isolation:** Employees scoped to `userId` / `email` on every attendance, leave, and employee query
- **Self-approval blocked:** Admins cannot approve their own leave requests
- **Mass assignment prevention:** Role, userId, and isActive stripped from client input
- **Rate limiting:** 20 auth attempts / 15 min, 200 API requests / min
- **Secure headers:** Helmet middleware
- **CORS:** Explicitly configured via `CORS_ORIGIN`
- **Audit trail:** Attendance corrections store before/after state, corrector, and reason
- **Duplicate prevention:** Unique indexes on email, employeeId, attendance (employeeId + date), payroll (employeeId + month + year)

---

## 🧪 Verification

The following flows have been tested end-to-end (26 automated checks, all passing):

- Login success returns real JWT; login failure returns 401
- No-token and tampered-token requests return 401
- Public registration always creates Employee role (no privilege escalation)
- Employee cannot create employees, departments, or access admin reports (403)
- Employee only sees own attendance/leave records
- Leave application validates date ranges, overlaps, and available balance
- Employees cannot approve their own leave (403)
- Admin can approve leave; duplicate approvals blocked (400)
- Approved leave auto-marks attendance records as 'leave'
- Duplicate check-ins blocked (400)
- Admin attendance corrections store audit trail
- Department deletion blocked when employees are assigned (400)
- Employee IDs auto-generated (EMP-0001 format)
- Dashboard metrics computed from real database records

---

## 📦 Production Deployment

### Backend
```bash
cd backend
npm install --omit=dev
npm start
```

Set `NODE_ENV=production` and use a strong `JWT_SECRET`. Use MongoDB Atlas for managed database hosting.

### Frontend
```bash
cd frontend
npm run build
```

Serve the `build/` folder with any static host (Nginx, Vercel, Netlify, S3+CloudFront). Set `REACT_APP_API_URL` to the production API URL at build time.

### Docker
A `Dockerfile` can be added per deployment target. The app is stateless aside from the database connection.

---

## 📝 Notes

- Currency displays in USD ($) throughout the application.
- Timezone defaults to Asia/Kolkata (IST)
- Public registration can only submit an Employee registration; both registration and personal information require separate Admin approvals before full Employee Portal access
- Use the seed script for a controlled admin setup in production
- Google OAuth is optional — set `REACT_APP_GOOGLE_CLIENT_ID` to enable it
