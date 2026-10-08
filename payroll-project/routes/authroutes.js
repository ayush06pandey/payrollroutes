const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("../database");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "payroll_secret_key_2026";

// Login API
router.post("/login", (req, res) => {

    try {

        const { identity, password, role } = req.body;

        // Check required fields
        if (!identity || !password || !role) {
            return res.status(400).json({
                success: false,
                message: "Identity, password and role are required."
            });
        }

        let user;

        // Employee login using Employee ID
        if (role === "emp") {

            user = db.prepare(`
                SELECT *
                FROM users
                WHERE employee_id = ?
            `).get(identity);

        } 
        
        // Executive / HR login using email
        else {

            user = db.prepare(`
                SELECT *
                FROM users
                WHERE email = ?
            `).get(identity);

        }

        // User not found
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid login credentials."
            });
        }

        // Check password
        const passwordMatch = bcrypt.compareSync(
            password,
            user.password
        );

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid login credentials."
            });
        }

        // Create JWT token
        const token = jwt.sign(
            {
                id: user.id,
                role: user.role,
                name: user.name
            },
            JWT_SECRET,
            {
                expiresIn: "2h"
            }
        );

        res.json({
            success: true,
            message: "Login successful.",
            token: token,
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                email: user.email,
                employee_id: user.employee_id
            }
        });

    } catch (error) {

        console.error("Login error:", error);

        res.status(500).json({
            success: false,
            message: "Internal server error."
        });
    }
});

module.exports = router;