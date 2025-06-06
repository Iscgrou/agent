import bcrypt from 'bcryptjs';
import database from '../database/index.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { ValidationError } from '../middleware/errorHandler.js';

class User {
    constructor(data) {
        this.id = data.id;
        this.email = data.email;
        this.fullName = data.full_name;
        this.role = data.role;
        this.status = data.status;
        this.lastLogin = data.last_login;
        this.loginAttempts = data.login_attempts;
        this.lockoutUntil = data.lockout_until;
        this.preferences = data.preferences;
        this.createdAt = data.created_at;
        this.updatedAt = data.updated_at;
    }

    static async create(userData) {
        const { email, password, fullName, role = 'user' } = userData;

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new ValidationError('Invalid email format');
        }

        // Validate password strength
        if (password.length < 8) {
            throw new ValidationError('Password must be at least 8 characters long');
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);

        try {
            const result = await database.query(
                `INSERT INTO users (email, password_hash, full_name, role)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [email, passwordHash, fullName, role]
            );

            logger.info('New user created', { userId: result.rows[0].id });
            return new User(result.rows[0]);
        } catch (error) {
            if (error.code === '23505') { // unique_violation
                throw new ValidationError('Email already exists');
            }
            throw error;
        }
    }

    static async findById(id) {
        const result = await database.query(
            'SELECT * FROM users WHERE id = $1',
            [id]
        );

        return result.rows[0] ? new User(result.rows[0]) : null;
    }

    static async findByEmail(email) {
        const result = await database.query(
            'SELECT * FROM users WHERE email = $1',
            [email]
        );

        return result.rows[0] ? new User(result.rows[0]) : null;
    }

    async verifyPassword(password) {
        const result = await database.query(
            'SELECT password_hash FROM users WHERE id = $1',
            [this.id]
        );

        if (!result.rows[0]) {
            return false;
        }

        return bcrypt.compare(password, result.rows[0].password_hash);
    }

    async updateLoginAttempts(success) {
        if (success) {
            await database.query(
                `UPDATE users 
                 SET login_attempts = 0, 
                     lockout_until = NULL, 
                     last_login = CURRENT_TIMESTAMP 
                 WHERE id = $1`,
                [this.id]
            );
        } else {
            await database.query(
                `UPDATE users 
                 SET login_attempts = login_attempts + 1,
                     lockout_until = CASE 
                         WHEN login_attempts + 1 >= $1 
                         THEN CURRENT_TIMESTAMP + interval '15 minutes'
                         ELSE lockout_until 
                     END
                 WHERE id = $2`,
                [config.security.maxLoginAttempts, this.id]
            );
        }
    }

    async isLocked() {
        const result = await database.query(
            `SELECT lockout_until, login_attempts 
             FROM users 
             WHERE id = $1`,
            [this.id]
        );

        if (!result.rows[0]) {
            return false;
        }

        const { lockout_until, login_attempts } = result.rows[0];
        
        if (!lockout_until) {
            return false;
        }

        if (new Date() < new Date(lockout_until)) {
            return true;
        }

        // Reset lockout if expired
        if (login_attempts >= config.security.maxLoginAttempts) {
            await database.query(
                `UPDATE users 
                 SET login_attempts = 0, 
                     lockout_until = NULL 
                 WHERE id = $1`,
                [this.id]
            );
        }

        return false;
    }

    async update(data) {
        const allowedFields = ['full_name', 'status', 'preferences'];
        const updates = [];
        const values = [];
        let paramCount = 1;

        for (const [key, value] of Object.entries(data)) {
            if (allowedFields.includes(key)) {
                updates.push(`${key.toLowerCase()} = $${paramCount}`);
                values.push(value);
                paramCount++;
            }
        }

        if (updates.length === 0) {
            return this;
        }

        values.push(this.id);
        const result = await database.query(
            `UPDATE users 
             SET ${updates.join(', ')} 
             WHERE id = $${paramCount}
             RETURNING *`,
            values
        );

        return new User(result.rows[0]);
    }

    async changePassword(currentPassword, newPassword) {
        // Verify current password
        const isValid = await this.verifyPassword(currentPassword);
        if (!isValid) {
            throw new ValidationError('Current password is incorrect');
        }

        // Validate new password
        if (newPassword.length < 8) {
            throw new ValidationError('New password must be at least 8 characters long');
        }

        // Hash new password
        const passwordHash = await bcrypt.hash(newPassword, config.security.bcryptRounds);

        // Update password
        await database.query(
            `UPDATE users 
             SET password_hash = $1 
             WHERE id = $2`,
            [passwordHash, this.id]
        );

        logger.info('Password changed successfully', { userId: this.id });
    }

    toJSON() {
        return {
            id: this.id,
            email: this.email,
            fullName: this.fullName,
            role: this.role,
            status: this.status,
            lastLogin: this.lastLogin,
            preferences: this.preferences,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt
        };
    }
}

export default User;
