const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("../database");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "payroll_secret_key_2026";

function authenticateManager(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Authentication token required."
        });
    }

    let user;
    try {
        user = jwt.verify(authHeader.slice(7), JWT_SECRET);
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token."
        });
    }

    if (!user || !["hr", "executive"].includes(user.role)) {
        return res.status(403).json({
            success: false,
            message: "You are not authorized to manage employees."
        });
    }

    req.user = user;
    next();
}

function parseEmployeeId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function getEmployee(id) {
    return db.prepare(`
        SELECT
            users.id,
            users.name,
            users.email,
            users.employee_id,
            users.role,
            users.created_at,
            COALESCE(employee_details.department, 'Unassigned') AS department,
            COALESCE(employee_details.region, 'Unassigned') AS region,
            COALESCE(employee_details.base_salary, 0) AS base_salary,
            COALESCE(employee_details.sales, 0) AS sales,
            COALESCE(employee_details.commission_rate, 0) AS commission_rate,
            COALESCE(employee_details.payroll_status, 'Pending') AS payroll_status
        FROM users
        LEFT JOIN employee_details
            ON employee_details.user_id = users.id
        WHERE users.id = ?
            AND users.role = 'employee'
    `).get(id);
}

function isValidEmail(email) {
    return typeof email === "string"
        && email.length <= 254
        && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateText(value, label, maxLength = 100) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
        return `${label} is required and must be no longer than ${maxLength} characters.`;
    }

    return null;
}

function validateAmount(value, label, maximum = Number.MAX_SAFE_INTEGER) {
    if (typeof value !== "number"
        && (typeof value !== "string" || value.trim() === "")) {
        return `${label} must be a number between 0 and ${maximum}.`;
    }

    const amount = Number(value);

    if (!Number.isFinite(amount) || amount < 0 || amount > maximum) {
        return `${label} must be a number between 0 and ${maximum}.`;
    }

    return null;
}

function respondWithDatabaseError(res, error, action) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({
            success: false,
            message: "An employee with that email or employee ID already exists."
        });
    }

    if (error.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
        return res.status(409).json({
            success: false,
            message: "This employee has related records and cannot be deleted."
        });
    }

    console.error(`${action} error:`, error);
    return res.status(500).json({
        success: false,
        message: `Unable to ${action.toLowerCase()}.`
    });
}

router.use(authenticateManager);

router.get("/", (req, res) => {
    try {
        const employees = db.prepare(`
            SELECT
                users.id,
                users.name,
                users.email,
                users.employee_id,
                users.role,
                users.created_at,
                employee_details.department,
                employee_details.region,
                COALESCE(employee_details.base_salary, 0) AS base_salary,
                COALESCE(employee_details.sales, 0) AS sales,
                COALESCE(employee_details.commission_rate, 0) AS commission_rate,
                COALESCE(employee_details.payroll_status, 'Pending') AS payroll_status
            FROM users
            LEFT JOIN employee_details
                ON employee_details.user_id = users.id
            WHERE users.role = 'employee'
            ORDER BY users.id DESC
        `).all();

        return res.json({ success: true, employees });
    } catch (error) {
        return respondWithDatabaseError(res, error, "Load employees");
    }
});

router.get("/:id", (req, res) => {
    const id = parseEmployeeId(req.params.id);

    if (id === null) {
        return res.status(400).json({
            success: false,
            message: "A valid employee ID is required."
        });
    }

    try {
        let employee;
        try {
            employee = getEmployee(id);
        } catch (error) {
            return respondWithDatabaseError(res, error, "Load employee");
        }

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: "Employee not found."
            });
        }

        return res.json({ success: true, employee });
    } catch (error) {
        return respondWithDatabaseError(res, error, "Load employee");
    }
});

router.post("/", (req, res) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({
            success: false,
            message: "A JSON employee record is required."
        });
    }

    const {
        name,
        email = null,
        department,
        region,
        base_salary,
        commission_rate,
        sales = 0
    } = req.body;

    const validationError =
        validateText(name, "Name")
        || validateText(department, "Department")
        || validateText(region, "Region")
        || validateAmount(base_salary, "Base salary")
        || validateAmount(commission_rate, "Commission rate", 100)
        || validateAmount(sales, "Sales");

    if (validationError) {
        return res.status(400).json({
            success: false,
            message: validationError
        });
    }

    if (email !== null && (typeof email !== "string" || !isValidEmail(email.trim()))) {
        return res.status(400).json({
            success: false,
            message: "A valid email address is required."
        });
    }

    const employeeId = `EMP-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
    const temporaryPassword = crypto.randomBytes(18).toString("base64url");

    try {
        const createEmployee = db.transaction(() => {
            const result = db.prepare(`
                INSERT INTO users (name, email, employee_id, password, role)
                VALUES (?, ?, ?, ?, 'employee')
            `).run(
                name.trim(),
                email === null ? null : email.trim().toLowerCase(),
                employeeId,
                bcrypt.hashSync(temporaryPassword, 10)
            );

            db.prepare(`
                INSERT INTO employee_details
                    (user_id, department, region, base_salary, sales, commission_rate)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                result.lastInsertRowid,
                department.trim(),
                region.trim(),
                Number(base_salary),
                Number(sales),
                Number(commission_rate)
            );

            return getEmployee(Number(result.lastInsertRowid));
        });

        const employee = createEmployee();
        return res.status(201).json({
            success: true,
            message: "Employee created successfully.",
            employee,
            temporaryPassword
        });
    } catch (error) {
        return respondWithDatabaseError(res, error, "Create employee");
    }
});

router.patch("/:id", (req, res) => {
    const id = parseEmployeeId(req.params.id);

    if (id === null) {
        return res.status(400).json({
            success: false,
            message: "A valid employee ID is required."
        });
    }

    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return res.status(400).json({
            success: false,
            message: "A JSON object with employee fields is required."
        });
    }

    const allowedFields = new Set([
        "name",
        "email",
        "department",
        "region",
        "base_salary",
        "sales",
        "commission_rate",
        "payroll_status"
    ]);
    const fields = Object.keys(req.body);

    if (fields.length === 0 || fields.some((field) => !allowedFields.has(field))) {
        return res.status(400).json({
            success: false,
            message: "Provide one or more supported employee fields to update."
        });
    }

    const employee = getEmployee(id);

    if (!employee) {
        return res.status(404).json({
            success: false,
            message: "Employee not found."
        });
    }

    const updates = {};

    for (const field of fields) {
        const value = req.body[field];
        let error = null;

        if (field === "name" || field === "department" || field === "region") {
            error = validateText(value, field);
        } else if (field === "email") {
            if (value !== null && (typeof value !== "string" || !isValidEmail(value.trim()))) {
                error = "A valid email address is required.";
            }
        } else if (field === "base_salary" || field === "sales") {
            error = validateAmount(value, field);
        } else if (field === "commission_rate") {
            error = validateAmount(value, field, 100);
        } else if (field === "payroll_status" && !["Paid", "Pending"].includes(value)) {
            error = "Payroll status must be either Paid or Pending.";
        }

        if (error) {
            return res.status(400).json({
                success: false,
                message: error
            });
        }

        if (field === "email") {
            updates[field] = value === null ? null : value.trim().toLowerCase();
        } else if (["name", "department", "region"].includes(field)) {
            updates[field] = value.trim();
        } else if (["base_salary", "sales", "commission_rate"].includes(field)) {
            updates[field] = Number(value);
        } else {
            updates[field] = value;
        }
    }

    try {
        const updateEmployee = db.transaction(() => {
            const userFields = fields.filter((field) => ["name", "email"].includes(field));
            const detailFields = fields.filter((field) => !["name", "email"].includes(field));

            if (userFields.length > 0) {
                const userAssignments = userFields.map((field) => `${field} = ?`).join(", ");
                const userValues = userFields.map((field) => updates[field]);

                db.prepare(`UPDATE users SET ${userAssignments} WHERE id = ?`)
                    .run(...userValues, id);
            }

            if (detailFields.length > 0) {
                const details = {
                    department: employee.department,
                    region: employee.region,
                    base_salary: employee.base_salary,
                    sales: employee.sales,
                    commission_rate: employee.commission_rate,
                    payroll_status: employee.payroll_status
                };
                Object.assign(details, updates);
                db.prepare(`
                    INSERT INTO employee_details (
                        user_id,
                        department,
                        region,
                        base_salary,
                        sales,
                        commission_rate,
                        payroll_status
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(user_id) DO UPDATE SET
                        department = excluded.department,
                        region = excluded.region,
                        base_salary = excluded.base_salary,
                        sales = excluded.sales,
                        commission_rate = excluded.commission_rate,
                        payroll_status = excluded.payroll_status,
                        updated_at = CURRENT_TIMESTAMP
                `).run(
                    id,
                    details.department,
                    details.region,
                    details.base_salary,
                    details.sales,
                    details.commission_rate,
                    details.payroll_status
                );
            }

            return getEmployee(id);
        });

        const updatedEmployee = updateEmployee();
        return res.json({
            success: true,
            message: "Employee updated successfully.",
            employee: updatedEmployee
        });
    } catch (error) {
        return respondWithDatabaseError(res, error, "Update employee");
    }
});

router.delete("/:id", (req, res) => {
    const id = parseEmployeeId(req.params.id);

    if (id === null) {
        return res.status(400).json({
            success: false,
            message: "A valid employee ID is required."
        });
    }

    try {
        const result = db.prepare(`
            DELETE FROM users
            WHERE id = ?
                AND role = 'employee'
        `).run(id);

        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                message: "Employee not found."
            });
        }

        return res.json({
            success: true,
            message: "Employee deleted successfully."
        });
    } catch (error) {
        return respondWithDatabaseError(res, error, "Delete employee");
    }
});

module.exports = router;
