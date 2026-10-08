const express = require("express");
const jwt = require("jsonwebtoken");

const db = require("../database");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "payroll_secret_key_2026";
const DEDUCTION_RATE = 0.18;

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Authentication token required."
        });
    }

    try {
        req.user = jwt.verify(authHeader.slice(7), JWT_SECRET);
        return next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token."
        });
    }
}

function requireManager(req, res, next) {
    if (!["hr", "executive"].includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: "You are not authorized to manage payroll."
        });
    }

    return next();
}

function parsePeriod(value) {
    if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
        return null;
    }

    return value;
}

function getPeriod(req, res) {
    const period = req.query.period || new Date().toISOString().slice(0, 7);
    const validPeriod = parsePeriod(period);

    if (!validPeriod) {
        res.status(400).json({
            success: false,
            message: "Payroll period must use YYYY-MM format."
        });
        return null;
    }

    return validPeriod;
}

function parseId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function respondWithDatabaseError(res, error, action) {
    console.error(`${action} error:`, error);
    return res.status(500).json({
        success: false,
        message: `Unable to ${action.toLowerCase()}.`
    });
}

router.use(authenticateToken);

router.get("/", requireManager, (req, res) => {
    const period = getPeriod(req, res);
    if (!period) return;

    try {
        const payroll = db.prepare(`
            SELECT
                payroll_records.id,
                payroll_records.user_id,
                users.name,
                users.email,
                users.employee_id,
                employee_details.department,
                employee_details.region,
                payroll_records.pay_period,
                payroll_records.base_salary,
                payroll_records.sales,
                payroll_records.commission_rate,
                payroll_records.commission_amount,
                payroll_records.gross_pay,
                payroll_records.deduction_rate,
                payroll_records.deductions,
                payroll_records.net_pay,
                payroll_records.status,
                payroll_records.created_at
            FROM payroll_records
            JOIN users ON users.id = payroll_records.user_id
            LEFT JOIN employee_details ON employee_details.user_id = users.id
            WHERE payroll_records.pay_period = ?
            ORDER BY users.name COLLATE NOCASE
        `).all(period);

        return res.json({ success: true, period, payroll });
    } catch (error) {
        return respondWithDatabaseError(res, error, "Load payroll");
    }
});

router.get("/mine", (req, res) => {
    const period = getPeriod(req, res);
    if (!period) return;

    try {
        const payroll = db.prepare(`
            SELECT
                payroll_records.id,
                payroll_records.user_id,
                users.name,
                users.email,
                users.employee_id,
                employee_details.department,
                employee_details.region,
                payroll_records.pay_period,
                payroll_records.base_salary,
                payroll_records.sales,
                payroll_records.commission_rate,
                payroll_records.commission_amount,
                payroll_records.gross_pay,
                payroll_records.deduction_rate,
                payroll_records.deductions,
                payroll_records.net_pay,
                payroll_records.status,
                payroll_records.created_at
            FROM payroll_records
            JOIN users ON users.id = payroll_records.user_id
            LEFT JOIN employee_details ON employee_details.user_id = users.id
            WHERE payroll_records.user_id = ?
                AND payroll_records.pay_period = ?
        `).get(req.user.id, period);

        if (!payroll) {
            return res.status(404).json({
                success: false,
                message: "No payroll record exists for this period."
            });
        }

        return res.json({ success: true, payroll });
    } catch (error) {
        return respondWithDatabaseError(res, error, "Load employee payroll");
    }
});

router.post("/run", requireManager, (req, res) => {
    const period = getPeriod(req, res);
    if (!period) return;

    try {
        const runPayroll = db.transaction(() => {
            const employees = db.prepare(`
                SELECT
                    users.id,
                    employee_details.base_salary,
                    employee_details.sales,
                    employee_details.commission_rate
                FROM users
                JOIN employee_details ON employee_details.user_id = users.id
                WHERE users.role = 'employee'
                ORDER BY users.id
            `).all();

            if (employees.length === 0) {
                return null;
            }

            const insertPayroll = db.prepare(`
                INSERT OR IGNORE INTO payroll_records (
                    user_id,
                    pay_period,
                    base_salary,
                    sales,
                    commission_rate,
                    commission_amount,
                    gross_pay,
                    deduction_rate,
                    deductions,
                    net_pay,
                    status,
                    generated_by
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?)
            `);

            let created = 0;
            for (const employee of employees) {
                const baseSalary = Number(employee.base_salary);
                const sales = Number(employee.sales);
                const commissionRate = Number(employee.commission_rate);
                const commissionAmount = sales * commissionRate / 100;
                const grossPay = baseSalary + commissionAmount;
                const deductions = grossPay * DEDUCTION_RATE;
                const result = insertPayroll.run(
                    employee.id,
                    period,
                    baseSalary,
                    sales,
                    commissionRate,
                    commissionAmount,
                    grossPay,
                    DEDUCTION_RATE,
                    deductions,
                    grossPay - deductions,
                    req.user.id
                );
                created += result.changes;
            }

            return created;
        });

        const created = runPayroll();
        if (created === null) {
            return res.status(400).json({
                success: false,
                message: "No employees have payroll details configured."
            });
        }

        return res.status(201).json({
            success: true,
            message: created > 0
                ? "Payroll generated successfully."
                : "Payroll already exists for all configured employees in this period.",
            period,
            created
        });
    } catch (error) {
        return respondWithDatabaseError(res, error, "Generate payroll");
    }
});

router.get("/:id", requireManager, (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
        return res.status(400).json({
            success: false,
            message: "A valid payroll record ID is required."
        });
    }

    try {
        const payroll = db.prepare(`
            SELECT
                payroll_records.id,
                payroll_records.user_id,
                users.name,
                users.email,
                users.employee_id,
                employee_details.department,
                employee_details.region,
                payroll_records.pay_period,
                payroll_records.base_salary,
                payroll_records.sales,
                payroll_records.commission_rate,
                payroll_records.commission_amount,
                payroll_records.gross_pay,
                payroll_records.deduction_rate,
                payroll_records.deductions,
                payroll_records.net_pay,
                payroll_records.status,
                payroll_records.created_at
            FROM payroll_records
            JOIN users ON users.id = payroll_records.user_id
            LEFT JOIN employee_details ON employee_details.user_id = users.id
            WHERE payroll_records.id = ?
        `).get(id);

        if (!payroll) {
            return res.status(404).json({
                success: false,
                message: "Payroll record not found."
            });
        }

        return res.json({ success: true, payroll });
    } catch (error) {
        return respondWithDatabaseError(res, error, "Load payroll record");
    }
});

router.patch("/:id/status", requireManager, (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
        return res.status(400).json({
            success: false,
            message: "A valid payroll record ID is required."
        });
    }

    const { status } = req.body || {};
    if (!["Paid", "Pending"].includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Payroll status must be either Paid or Pending."
        });
    }

    try {
        const result = db.prepare(`
            UPDATE payroll_records
            SET status = ?
            WHERE id = ?
        `).run(status, id);

        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                message: "Payroll record not found."
            });
        }

        const payroll = db.prepare(`
            SELECT
                id,
                user_id,
                pay_period,
                base_salary,
                sales,
                commission_rate,
                commission_amount,
                gross_pay,
                deduction_rate,
                deductions,
                net_pay,
                status,
                created_at
            FROM payroll_records
            WHERE id = ?
        `).get(id);

        return res.json({
            success: true,
            message: "Payroll status updated successfully.",
            payroll
        });
    } catch (error) {
        return respondWithDatabaseError(res, error, "Update payroll status");
    }
});

module.exports = router;
