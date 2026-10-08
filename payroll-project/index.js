const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 5000;

// Initialize database
require("./database");

// Login routes
const authRoutes = require("./routes/authroutes");
const attendanceRoutes = require("./routes/attendanceroutes");
const employeeRoutes = require("./routes/employeeroutes");
const payrollRoutes = require("./routes/payrollroutes");
const leaveRoutes = require("./routes/leaveroutes");

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend files
app.use(express.static(__dirname));

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/leaves", leaveRoutes);

// Home page
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "loginpage.html"));
});

// Backend test
app.get("/api/test", (req, res) => {
    res.json({
        success: true,
        message: "Payroll backend is working!"
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});