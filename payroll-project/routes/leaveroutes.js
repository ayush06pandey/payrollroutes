const express = require("express");
const jwt = require("jsonwebtoken");

const db = require("../database");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "payroll_secret_key_2026";

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
            message: "You are not authorized to manage leave requests."
        });
    }

    return next();
}

function parseId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value;
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
    try {
        const leaveRequests = db.prepare(`
            SELECT
                leave_requests.id,
                leave_requests.user_id,
                users.name,
                users.email,
                users.employee_id,
                employee_details.department,
                leave_requests.leave_type,
                leave_requests.start_date,
                leave_requests.end_date,
                leave_requests.reason,
                leave_requests.status,
                leave_requests.reviewed_by,
                leave_requests.reviewed_at,
                leave_requests.created_at
            FROM leave_requests
            JOIN users ON users.id = leave_requests.user_id
            LEFT JOIN employee_details
                ON employee_details.user_id = leave_requests.user_id
            ORDER BY
                CASE leave_requests.status
                    WHEN 'Pending' THEN 0
                    ELSE 1
                END,
                leave_requests.created_at DESC
        `).all();

        return res.json({ success: true, leaveRequests });
    } catch (error) {
        return respondWithDatabaseError(res, error, "Load leave requests");
    }
});

router.get("/mine", (req, res) => {
    try {
        const leaveRequests = db.prepare(`
            SELECT
                id,
                user_id,
                leave_type,
                start_date,
                end_date,
                reason,
                status,
                reviewed_at,
                created_at
            FROM leave_requests
            WHERE user_id = ?
            ORDER BY created_at DESC
        `).all(req.user.id);

        return res.json({ success: true, leaveRequests });
    } catch (error) {
        return respondWithDatabaseError(res, error, "Load your leave requests");
    }
});

router.post("/", (req, res) => {
    if (req.user.role !== "employee") {
        return res.status(403).json({
            success: false,
            message: "Only employees can submit leave requests."
        });
    }

    const body = req.body || {};
    const leaveType = typeof body.leave_type === "string"
        ? body.leave_type.trim()
        : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const { start_date: startDate, end_date: endDate } = body;

    if (
        leaveType.length < 1 ||
        leaveType.length > 100 ||
        !isValidDate(startDate) ||
        !isValidDate(endDate) ||
        endDate < startDate ||
        reason.length < 1 ||
        reason.length > 1000
    ) {
        return res.status(400).json({
            success: false,
            message: "Provide a leave type, a valid date range, and a reason of at most 1000 characters."
        });
    }

    try {
        const result = db.prepare(`
            INSERT INTO leave_requests (
                user_id,
                leave_type,
                start_date,
                end_date,
                reason
            )
            VALUES (?, ?, ?, ?, ?)
        `).run(req.user.id, leaveType, startDate, endDate, reason);

        const leaveRequest = db.prepare(`
            SELECT
                id,
                user_id,
                leave_type,
                start_date,
                end_date,
                reason,
                status,
                created_at
            FROM leave_requests
            WHERE id = ?
        `).get(result.lastInsertRowid);

        return res.status(201).json({
            success: true,
            message: "Leave request submitted successfully.",
            leaveRequest
        });
    } catch (error) {
        return respondWithDatabaseError(res, error, "Submit leave request");
    }
});

router.patch("/:id/status", requireManager, (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) {
        return res.status(400).json({
            success: false,
            message: "A valid leave request ID is required."
        });
    }

    const { status } = req.body || {};
    if (!["Approved", "Rejected"].includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Leave request status must be either Approved or Rejected."
        });
    }

    try {
        const result = db.prepare(`
            UPDATE leave_requests
            SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'Pending'
        `).run(status, req.user.id, id);

        if (result.changes === 0) {
            const existingRequest = db.prepare(`
                SELECT id, status
                FROM leave_requests
                WHERE id = ?
            `).get(id);

            if (!existingRequest) {
                return res.status(404).json({
                    success: false,
                    message: "Leave request not found."
                });
            }

            return res.status(409).json({
                success: false,
                message: "This leave request has already been reviewed."
            });
        }

        const leaveRequest = db.prepare(`
            SELECT
                leave_requests.id,
                leave_requests.user_id,
                leave_requests.leave_type,
                leave_requests.start_date,
                leave_requests.end_date,
                leave_requests.reason,
                leave_requests.status,
                leave_requests.reviewed_by,
                leave_requests.reviewed_at,
                leave_requests.created_at
            FROM leave_requests
            WHERE leave_requests.id = ?
        `).get(id);

        return res.json({
            success: true,
            message: `Leave request ${status.toLowerCase()} successfully.`,
            leaveRequest
        });
    } catch (error) {
        return respondWithDatabaseError(res, error, "Review leave request");
    }
});

module.exports = router;
