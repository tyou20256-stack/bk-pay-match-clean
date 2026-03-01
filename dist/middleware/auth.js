"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRequired = authRequired;
const database_js_1 = require("../services/database.js");
function authRequired(req, res, next) {
    const token = req.cookies?.bkpay_token || req.headers.authorization?.replace('Bearer ', '');
    if (!token || !(0, database_js_1.validateSession)(token)) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    next();
}
