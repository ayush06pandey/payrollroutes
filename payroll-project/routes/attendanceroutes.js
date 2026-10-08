const express = require("express");
const jwt = require("jsonwebtoken");

const db = require("../database");

const router = express.Router();

const JWT_SECRET =
    process.env.JWT_SECRET || "payroll_secret_key_2026";


// ==============================
// AUTHENTICATION
// ==============================

function authenticateToken(req, res, next) {

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {

        return res.status(401).json({
            success: false,
            message: "Authentication token required."
        });
    }

    const token = authHeader.split(" ")[1];

    try {

        const user = jwt.verify(token, JWT_SECRET);

        req.user = user;

        next();

    } catch (error) {

        return res.status(401).json({
            success: false,
            message: "Invalid or expired token."
        });
    }
}


// ==============================
// CLOCK IN
// ==============================

router.post("/clock-in", authenticateToken, (req, res) => {

    try {

        const userId = req.user.id;

        const activeAttendance = db.prepare(`
            SELECT *
            FROM attendance
            WHERE user_id = ?
            AND status = 'active'
            ORDER BY id DESC
            LIMIT 1
        `).get(userId);


        if (activeAttendance) {

            return res.status(400).json({
                success: false,
                message: "You are already clocked in."
            });
        }


        const result = db.prepare(`
            INSERT INTO attendance
            (
                user_id,
                clock_in,
                status
            )
            VALUES
            (
                ?,
                datetime('now', 'localtime'),
                'active'
            )
        `).run(userId);


        const attendance = db.prepare(`
            SELECT *
            FROM attendance
            WHERE id = ?
        `).get(result.lastInsertRowid);


        res.json({
            success: true,
            message: "Clocked in successfully.",
            attendance: attendance
        });

    } catch (error) {

        console.error("Clock-in error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to clock in."
        });
    }
});


// ==============================
// CLOCK OUT
// ==============================

router.post("/clock-out", authenticateToken, (req, res) => {

    try {

        const userId = req.user.id;

        const activeAttendance = db.prepare(`
            SELECT *
            FROM attendance
            WHERE user_id = ?
            AND status = 'active'
            ORDER BY id DESC
            LIMIT 1
        `).get(userId);


        if (!activeAttendance) {

            return res.status(400).json({
                success: false,
                message: "You are not currently clocked in."
            });
        }


        db.prepare(`
            UPDATE attendance
            SET
                clock_out = datetime('now', 'localtime'),
                status = 'completed'
            WHERE id = ?
        `).run(activeAttendance.id);


        const attendance = db.prepare(`
            SELECT *
            FROM attendance
            WHERE id = ?
        `).get(activeAttendance.id);


        res.json({
            success: true,
            message: "Clocked out successfully.",
            attendance: attendance
        });

    } catch (error) {

        console.error("Clock-out error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to clock out."
        });
    }
});


// ==============================
// CHECK CURRENT STATUS
// ==============================

router.get("/status", authenticateToken, (req, res) => {

    try {

        const userId = req.user.id;

        const activeAttendance = db.prepare(`
            SELECT *
            FROM attendance
            WHERE user_id = ?
            AND status = 'active'
            ORDER BY id DESC
            LIMIT 1
        `).get(userId);


        res.json({
            success: true,
            clockedIn: !!activeAttendance,
            attendance: activeAttendance || null
        });

    } catch (error) {

        console.error("Attendance status error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to get attendance status."
        });
    }
});
router.get("/history", authenticateToken, (req, res) => {
    console.log("HISTORY ROUTE CALLED");

    try {
        const userId = req.user.id;

        const records = db.prepare(`
            SELECT
                id,
                clock_in,
                clock_out,
                status,
                created_at
            FROM attendance
            WHERE user_id = ?
            ORDER BY id DESC
        `).all(userId);

        res.json({
            success: true,
            records
        });

    } catch (error) {
        console.error("Attendance history error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load attendance history."
        });
    }
});


module.exports = router;