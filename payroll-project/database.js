const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const db = new Database("payroll.db");

// Enable foreign keys
db.pragma("foreign_keys = ON");

// Create users before tables that reference them.
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        employee_id TEXT UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('executive', 'hr', 'employee')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        clock_in DATETIME NOT NULL,
        clock_out DATETIME,
        status TEXT NOT NULL DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS employee_details (
        user_id INTEGER PRIMARY KEY,
        department TEXT NOT NULL,
        region TEXT NOT NULL,
        base_salary REAL NOT NULL DEFAULT 0 CHECK(base_salary >= 0),
        sales REAL NOT NULL DEFAULT 0 CHECK(sales >= 0),
        commission_rate REAL NOT NULL DEFAULT 0
            CHECK(commission_rate >= 0 AND commission_rate <= 100),
        payroll_status TEXT NOT NULL DEFAULT 'Pending'
            CHECK(payroll_status IN ('Paid', 'Pending')),
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS payroll_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        pay_period TEXT NOT NULL CHECK(pay_period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
        base_salary REAL NOT NULL CHECK(base_salary >= 0),
        sales REAL NOT NULL CHECK(sales >= 0),
        commission_rate REAL NOT NULL CHECK(commission_rate >= 0 AND commission_rate <= 100),
        commission_amount REAL NOT NULL CHECK(commission_amount >= 0),
        gross_pay REAL NOT NULL CHECK(gross_pay >= 0),
        deduction_rate REAL NOT NULL CHECK(deduction_rate >= 0 AND deduction_rate <= 1),
        deductions REAL NOT NULL CHECK(deductions >= 0),
        net_pay REAL NOT NULL CHECK(net_pay >= 0),
        status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Paid', 'Pending')),
        generated_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, pay_period),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
        FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE RESTRICT
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS leave_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        leave_type TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Pending'
            CHECK(status IN ('Pending', 'Approved', 'Rejected')),
        reviewed_by INTEGER,
        reviewed_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    )
`);

db.exec(`
    CREATE INDEX IF NOT EXISTS idx_leave_requests_user_dates
    ON leave_requests(user_id, start_date, end_date)
`);

// Demo users
const users = [
    {
        name: "sameer sahu",
        email: "s.sahu@apexanalytics.io",
        employee_id: 101,
        password: "ExecutivePass2026!",
        role: "executive"
    },
    {
        name: "shubham sahu",
        email: "shu.sahu@apexanalytics.io",
        employee_id: 102,
        password: "HRPayrollMaster2026!",
        role: "hr"
    },
    {
        name: "Sales Representative",
        email: null,
        employee_id: "EMP-88412",
        password: "SalesRepPortal!2026",
        role: "employee"
    }
];

// Insert demo users only if they don't already exist
const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users
    (name, email, employee_id, password, role)
    VALUES (?, ?, ?, ?, ?)
`);

for (const user of users) {
    const hashedPassword = bcrypt.hashSync(user.password, 10);

    insertUser.run(
        user.name,
        user.email,
        user.employee_id,
        hashedPassword,
        user.role
    );
}

console.log("Database initialized successfully.");

module.exports = db;
