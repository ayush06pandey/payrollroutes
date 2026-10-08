# Payroll Management System

An Express and SQLite payroll management app with employee, HR, and executive
views.

## Setup

1. Install Node.js.
2. From this directory, install dependencies:

   ```sh
   npm install
   ```

3. Copy `.env.example` to `.env` and set `JWT_SECRET` to a long, random value.
4. Start the server:

   ```sh
   npm start
   ```

5. Open `http://localhost:5000`.

The SQLite database (`payroll.db`) is created locally when the server starts.
Demo users are inserted if they do not already exist. Do not use the seeded
demo accounts or the development fallback secret in a deployed environment.

## API

All endpoints are served from the same origin. Protected endpoints require
`Authorization: Bearer <token>`.

| Area | Endpoints |
| --- | --- |
| Authentication | `POST /api/auth/login` |
| Employees | `GET/POST /api/employees`, `GET/PATCH/DELETE /api/employees/:id` (HR/executive) |
| Attendance | `POST /api/attendance/clock-in`, `POST /api/attendance/clock-out`, `GET /api/attendance/status`, `GET /api/attendance/history` |
| Leave | `POST /api/leaves`, `GET /api/leaves/mine`, `GET /api/leaves` (HR/executive), `PATCH /api/leaves/:id/status` (HR/executive) |
| Payroll | `GET /api/payroll/mine`, `GET /api/payroll`, `POST /api/payroll/run`, `GET /api/payroll/:id`, `PATCH /api/payroll/:id/status` |
| Health check | `GET /api/test` |
